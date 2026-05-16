import React, { useEffect, useRef, useState } from 'react';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import { useSocket } from '../context/SocketContext';
import { Clock, Tag, Image as ImageIcon, Sparkles, AlertCircle, CheckCircle2, User, Download, X, Crosshair, Users, Search } from 'lucide-react';
import BookingDialog from '../components/BookingDialog';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import MyJobsPanel from '../components/MyJobsPanel';
import ImageLightbox from '../components/ImageLightbox';
import MediaPreview from '../components/ui/MediaPreview';
import WorkflowChip from '../components/ui/WorkflowChip';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ProgressViz from '../components/ui/ProgressViz';
import { getImageUrl, getDownloadUrl } from '../utils/api';
import { getUserColor } from '../utils/userColor';
import { getDisplayPrompt } from '../utils/jobDisplay';
import { computeEtaSeconds } from '../utils/jobEta';

/**
 * Scheduler Page Component
 * 
 * The main interface for students to view and schedule jobs.
 * 
 * Features:
 * - Interactive Timeline (vis-timeline): Visualizes scheduled jobs
 * - Real-time Updates: Listens to socket events for job status changes
 * - Job Management: Create, delete, reorder jobs
 * - Job Visualization: Progress bars, previews, and details
 * 
 * Key Components:
 * - Timeline: Drag-and-drop interface for scheduling
 * - BookingDialog: Form to create new jobs
 * - Card/Grid: Display of recent generations
 * - MyJobsPanel: Sidebar for managing user's own jobs
 */
// Visible timeline window: 10 minutes of past context, 50 minutes ahead.
const WINDOW_BEFORE_MS = 10 * 60 * 1000;
const WINDOW_AFTER_MS = 50 * 60 * 1000;
const FOLLOW_TICK_MS = 10 * 1000;

const SchedulerPage = () => {
    const { state, bookJob, deleteJob, cancelJob, reorderJob, username, workflowsById } = useSocket();
    const timelineRef = useRef(null);
    const containerRef = useRef(null);
    const itemsRef = useRef(null); // vis-data DataSet
    const [selectedJob, setSelectedJob] = useState(null);
    const [isBookingOpen, setIsBookingOpen] = useState(false);
    const [bookingTime, setBookingTime] = useState(Date.now());
    const [isMyJobsOpen, setIsMyJobsOpen] = useState(false);
    const [lightboxJob, setLightboxJob] = useState(null);
    const [followNow, setFollowNow] = useState(true);
    const [prefillParams, setPrefillParams] = useState(null);
    // 'mine' (default — students only see their own results) or 'all' (everyone).
    const [activeTab, setActiveTab] = useState('mine');
    // User-filter dropdown in the "All" tab. 'all' shows everyone.
    const [userFilter, setUserFilter] = useState('all');
    // Free-text search across prompt + user_id (case-insensitive). Filters
    // the grid below; doesn't affect the timeline above (the timeline is a
    // schedule view, not a results view, so hiding bookings there would
    // confuse the room).
    const [searchQuery, setSearchQuery] = useState('');
    // Pending delete/cancel; populated by the X button. Drives ConfirmDialog.
    const [pendingAction, setPendingAction] = useState(null);

    const reuseJob = (job) => {
        setPrefillParams(job.params || {});
        // Find the next un-collided slot at or after now.
        setBookingTime(Date.now());
        setIsBookingOpen(true);
    };

    // Use refs to keep track of latest state for timeline callbacks without recreating the timeline
    const stateRef = useRef(state);
    const usernameRef = useRef(username);
    const followNowRef = useRef(followNow);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    useEffect(() => {
        followNowRef.current = followNow;
    }, [followNow]);

    const slideToNow = () => {
        if (!timelineRef.current) return;
        timelineRef.current.setWindow(
            new Date(Date.now() - WINDOW_BEFORE_MS),
            new Date(Date.now() + WINDOW_AFTER_MS),
            { animation: { duration: 400, easingFunction: 'easeInOutQuad' } }
        );
    };

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize DataSet
        const items = new DataSet([]);
        itemsRef.current = items;

        const options = {
            stack: false,
            start: new Date(Date.now() - WINDOW_BEFORE_MS),
            end: new Date(Date.now() + WINDOW_AFTER_MS),
            showCurrentTime: true,
            editable: {
                add: true,
                updateTime: true,
                updateGroup: false,
                remove: true,
                overrideItems: false
            },
            onAdd: (item, callback) => {
                setBookingTime(item.start.getTime());
                setIsBookingOpen(true);
                callback(null); // Don't add directly, wait for server
            },
            onMove: (item, callback) => {
                const job = stateRef.current.jobs.find(j => j.id === item.id);
                if (job && job.user_id === usernameRef.current && job.status === 'scheduled') {
                    reorderJob(item.id, item.start.getTime());
                    callback(item);
                } else {
                    alert("You can only move your own scheduled jobs.");
                    callback(null);
                }
            },
            onRemove: (item, callback) => {
                const job = stateRef.current.jobs.find(j => j.id === item.id);
                if (job && job.user_id === usernameRef.current) {
                    if (window.confirm("Remove this job from the queue?")) {
                        deleteJob(item.id);
                        callback(item);
                    } else {
                        callback(null);
                    }
                } else {
                    alert("You can only remove your own jobs.");
                    callback(null);
                }
            },
            margin: { item: 10, axis: 5 },
            height: '100%',
            zoomMin: 1000 * 60 * 5, // 5 min
            zoomMax: 1000 * 60 * 60 * 24 // 24 hours
        };

        const timeline = new Timeline(containerRef.current, items, options);
        timelineRef.current = timeline;

        timeline.on('select', (properties) => {
            const jobId = properties.items[0];
            const job = stateRef.current.jobs.find(j => j.id === jobId);
            setSelectedJob(job);
        });

        timeline.on('doubleClick', (properties) => {
            if (!properties.item) {
                setBookingTime(properties.time.getTime());
                setIsBookingOpen(true);
            }
        });

        // Disable follow mode if the user manually pans/zooms.
        timeline.on('rangechange', (props) => {
            if (props.byUser && followNowRef.current) {
                setFollowNow(false);
            }
        });

        // Periodically slide the window so "now" stays in view while following.
        const followInterval = setInterval(() => {
            if (!followNowRef.current || !timelineRef.current) return;
            timelineRef.current.setWindow(
                new Date(Date.now() - WINDOW_BEFORE_MS),
                new Date(Date.now() + WINDOW_AFTER_MS),
                { animation: { duration: 400, easingFunction: 'easeInOutQuad' } }
            );
        }, FOLLOW_TICK_MS);

        return () => {
            clearInterval(followInterval);
            if (timelineRef.current) {
                timelineRef.current.destroy();
                timelineRef.current = null;
            }
        };
    }, [reorderJob, deleteJob]); // Stable callbacks from SocketContext



    /**
     * Effect to synchronize server state with the Timeline DataSet.
     * 
     * Maps global job state to vis-timeline items:
     * - Status determines color/class (scheduled, processing, completed)
     * - Ownership determines editability (can only move own jobs)
     * - Updates existing items to preserve animation state
     */
    useEffect(() => {
        if (itemsRef.current) {
            // vis-timeline's `content` field is inserted as raw HTML, so any
            // user-controlled string in there has to be HTML-escaped first.
            const escapeHtml = (s) => String(s ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
            const itemsData = state.jobs.map(job => {
                const isMine = job.user_id === username;
                const shortId = (job.user_id || '???').substring(0, 3).toUpperCase();
                const color = getUserColor(job.user_id);
                const promptText = getDisplayPrompt(job);

                return {
                    id: job.id,
                    // Inline-style the user-color prefix so the same student's
                    // bookings group visually at a glance. Body text stays
                    // unstyled — status drives that via className.
                    content: `<div class="flex items-center space-x-2 w-full truncate">
                                <span class="font-bold text-[10px]" style="color:${color.ring}">${escapeHtml(isMine ? 'ME' : shortId)}</span>
                                <span class="font-medium text-xs truncate">${escapeHtml(promptText)}</span>
                              </div>`,
                    start: new Date(job.time_slot),
                    end: new Date(job.time_slot + (state.benchmark_ms || 60000)), // Default to 1 min if benchmark not ready
                    className: `${isMine ? 'vis-item-mine' : ''} ${job.status === 'processing' ? 'vis-item-processing' :
                        (job.status === 'completed' ? 'vis-item-completed' : 'vis-item-scheduled')}`,
                    // Left stripe = user color. Background tint is intentionally
                    // skipped — the status-driven className already drives bg.
                    style: `border-left: 3px solid ${color.dot};`,
                    title: `${job.user_id}: ${promptText}`,
                    editable: isMine && job.status === 'scheduled'
                };
            });

            // update existing items or add new ones, removing old ones
            const existingIds = itemsRef.current.getIds();
            const newIds = itemsData.map(i => i.id);

            // Remove items not in the new list
            const toRemove = existingIds.filter(id => !newIds.includes(id));
            if (toRemove.length > 0) itemsRef.current.remove(toRemove);

            // Update or add items
            itemsRef.current.update(itemsData);
        }
    }, [state.jobs, state.benchmark_ms, username]);

    return (
        <div className="h-full flex overflow-hidden relative">
            {/* Main Content Area */}
            <div className="flex-1 flex flex-col p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center space-x-2 text-primary mb-1">
                            <Sparkles size={16} />
                            <span className="text-[10px] font-bold uppercase tracking-widest leading-none">Creative Queue</span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Timeline</h2>
                        <p className="text-muted text-sm sm:text-base mt-1">Hello, <span className="text-primary font-bold">{username}</span>. Plan your generations.</p>
                        {state.workflow_info?.id && (
                            <div className="mt-2 rounded-lg bg-primary/5 border border-primary/20 p-3 max-w-2xl space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Sparkles size={12} className="text-primary" />
                                    <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">Active workflow</span>
                                    <span className="text-xs font-medium text-primary">{state.workflow_info.name}</span>
                                    {state.workflow_info.category && state.workflow_info.category !== 'other' && (
                                        <Badge variant="primary" className="text-[9px] py-0 h-4 uppercase">{state.workflow_info.category}</Badge>
                                    )}
                                </div>
                                {state.workflow_info.description && (
                                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                                        {state.workflow_info.description}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center space-x-2 sm:space-x-4">
                        <Button
                            variant="primary"
                            size="lg"
                            icon={Sparkles}
                            onClick={() => {
                                setBookingTime(Date.now());
                                setIsBookingOpen(true);
                            }}
                            className="shadow-lg shadow-primary/20"
                        >
                            Schedule a job
                        </Button>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                className="xl:hidden"
                                onClick={() => setIsMyJobsOpen(true)}
                            >
                                <User size={16} />
                            </Button>
                            <Badge variant={state.system_status === 'ready' ? 'success' : 'warning'} className="text-[10px] py-1">
                                System: {state.system_status}
                            </Badge>
                        </div>
                        <Button
                            variant={followNow ? 'primary' : 'secondary'}
                            size="sm"
                            icon={Crosshair}
                            onClick={() => {
                                setFollowNow(true);
                                slideToNow();
                            }}
                            title={followNow ? 'Following current time — click to re-center' : 'Recenter on current time and follow'}
                        >
                            {followNow ? 'Following' : 'Now'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setFollowNow(false);
                                if (timelineRef.current) timelineRef.current.fit();
                            }}
                            title="Auto-fit timeline to show all jobs"
                        >
                            Fit View
                        </Button>
                    </div>
                </div>

                <div className="space-y-4 px-4 sm:px-12 lg:px-20">
                    <h3 className="text-sm font-semibold text-muted uppercase tracking-widest ml-1">Live Schedule</h3>
                    <Card className="flex-none border-slate-700/50 bg-background/50 shadow-inner" noPadding>
                        <div ref={containerRef} className="h-[180px] sm:h-[220px] w-full" />
                    </Card>
                </div>

                <BookingDialog
                    isOpen={isBookingOpen}
                    onClose={() => { setIsBookingOpen(false); setPrefillParams(null); }}
                    initialTime={bookingTime}
                    initialParams={prefillParams}
                    onConfirm={({ prompt, params, time }) => bookJob(time || bookingTime, prompt, params)}
                />

                <ImageLightbox
                    isOpen={!!lightboxJob}
                    onClose={() => setLightboxJob(null)}
                    job={lightboxJob}
                    onReuse={reuseJob}
                />

                <div className="space-y-6 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-border">
                            <button
                                onClick={() => setActiveTab('mine')}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${activeTab === 'mine' ? 'bg-primary text-white shadow' : 'text-muted hover:text-white'}`}
                            >
                                My Generations
                            </button>
                            <button
                                onClick={() => setActiveTab('all')}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${activeTab === 'all' ? 'bg-primary text-white shadow' : 'text-muted hover:text-white'}`}
                            >
                                All Jobs
                            </button>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search prompts…"
                                    className="bg-surface border border-border rounded-md pl-8 pr-7 py-1.5 text-xs text-white placeholder-muted w-48 focus:outline-none focus:border-primary/50"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted hover:text-white hover:bg-white/5"
                                        title="Clear"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            {activeTab === 'all' && (() => {
                                const users = Array.from(new Set(state.jobs.map(j => j.user_id))).sort();
                                return (
                                    <div className="flex items-center gap-2">
                                        <Users size={14} className="text-muted" />
                                        <select
                                            value={userFilter}
                                            onChange={(e) => setUserFilter(e.target.value)}
                                            className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-white"
                                        >
                                            <option value="all">All users ({state.jobs.length})</option>
                                            {users.map(u => {
                                                const count = state.jobs.filter(j => j.user_id === u).length;
                                                return <option key={u} value={u}>{u === username ? `${u} (you)` : u} — {count}</option>;
                                            })}
                                        </select>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {(() => {
                        const q = searchQuery.trim().toLowerCase();
                        const filtered = state.jobs.filter(job => {
                            if (activeTab === 'mine' && job.user_id !== username) return false;
                            if (activeTab === 'all' && userFilter !== 'all' && job.user_id !== userFilter) return false;
                            if (q) {
                                // Search against the resolved display prompt so jobs whose
                                // headline `prompt` was empty (LTX-style with positive_prompt)
                                // still match on what the user actually typed.
                                const prompt = getDisplayPrompt(job).toLowerCase();
                                const user = (job.user_id || '').toLowerCase();
                                if (!prompt.includes(q) && !user.includes(q)) return false;
                            }
                            return true;
                        });
                        return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                        {filtered.length === 0 ? (
                            <div className="col-span-full py-12 flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                                <Clock size={48} />
                                <p className="text-lg font-medium">
                                    {q
                                        ? `No jobs match "${searchQuery}"`
                                        : activeTab === 'mine' ? "You haven't generated anything yet" : 'No jobs match this filter'}
                                </p>
                                {activeTab === 'mine' && !q && <Button variant="ghost" onClick={() => setIsBookingOpen(true)}>Book your first slot</Button>}
                            </div>
                        ) : (
                            filtered.sort((a, b) => b.time_slot - a.time_slot).map((job) => (
                                <Card
                                    key={job.id}
                                    className={`group relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-pointer ${selectedJob?.id === job.id ? 'ring-2 ring-primary border-primary/50' : 'hover:border-primary/30'}`}
                                    onClick={() => {
                                        setSelectedJob(job);
                                        if (job.status === 'completed') setLightboxJob(job);
                                    }}
                                >
                                    {(() => {
                                        const isMine = job.user_id === username;
                                        const isScheduled = job.status === 'scheduled';
                                        const isProcessing = job.status === 'processing';
                                        const isCompletedOrFailed = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
                                        const hasAction = isScheduled || isProcessing || isCompletedOrFailed;
                                        if (!hasAction && !isMine) return null;
                                        return (
                                            <div className="absolute top-0 right-0 flex items-center z-10">
                                                {hasAction && (() => {
                                                    let title, message, kind;
                                                    if (isProcessing) {
                                                        title = 'Cancel running job?';
                                                        message = isMine
                                                            ? 'This will interrupt ComfyUI for your job. The job will be marked as cancelled.'
                                                            : `Cancel ${job.user_id}'s running job? ComfyUI will be interrupted.`;
                                                        kind = 'cancel';
                                                    } else if (isScheduled) {
                                                        title = 'Cancel scheduled job?';
                                                        message = isMine
                                                            ? 'Remove this scheduled job from the timeline?'
                                                            : `Remove ${job.user_id}'s scheduled job from the timeline?`;
                                                        kind = 'delete';
                                                    } else {
                                                        title = 'Delete this result?';
                                                        message = isMine
                                                            ? 'Delete this job record and its output file from disk? This cannot be undone.'
                                                            : `Delete ${job.user_id}'s job record and output file from disk? This cannot be undone.`;
                                                        kind = 'delete';
                                                    }
                                                    return (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPendingAction({ jobId: job.id, kind, isMine, title, message, userId: job.user_id });
                                                            }}
                                                            className="p-1.5 bg-danger/10 text-danger hover:bg-danger hover:text-white transition-colors rounded-bl-lg border-l border-b border-danger/20"
                                                            title={isMine ? title : `${title} (admin password required)`}
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    );
                                                })()}
                                                {isMine && (
                                                    <div className="p-1 px-2 bg-primary/20 text-primary text-[8px] font-bold uppercase tracking-tighter rounded-bl-lg border-l border-b border-primary/20">
                                                        Yours
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    <div className="flex flex-col h-full space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div className="space-y-1">
                                                <div className="flex items-center space-x-2">
                                                    <Clock size={12} className="text-muted" />
                                                    <span className="text-[10px] font-mono text-muted">{new Date(job.time_slot).toLocaleTimeString()}</span>
                                                </div>
                                                <Badge variant={job.status === 'completed' ? 'success' : job.status === 'processing' ? 'warning' : 'primary'}>
                                                    {job.status}
                                                </Badge>
                                            </div>
                                            <span className="text-[10px] text-muted font-mono">#{job.id.substring(0, 6)}</span>
                                        </div>

                                        <div className="flex-1 aspect-video bg-background rounded-lg border border-border/50 flex items-center justify-center overflow-hidden relative shadow-inner">
                                            {job.status === 'completed' ? (
                                                <div className="relative w-full h-full group/img">
                                                    <MediaPreview filename={job.result_filename} />
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const link = document.createElement('a');
                                                            link.href = getDownloadUrl(job.result_filename);
                                                            link.download = job.result_filename;
                                                            document.body.appendChild(link);
                                                            link.click();
                                                            document.body.removeChild(link);
                                                        }}
                                                        className="absolute bottom-2 right-2 p-2 rounded-full bg-black/60 hover:bg-primary text-white backdrop-blur-md opacity-0 group-hover/img:opacity-100 transition-all duration-300 scale-75 group-hover/img:scale-100 shadow-lg border border-white/10"
                                                        title="Download Image"
                                                    >
                                                        <Download size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center text-muted/20 w-full px-4">
                                                    <Sparkles size={32} className={job.status === 'processing' ? 'animate-pulse text-primary/50' : ''} />
                                                    <span className="text-[10px] mt-2 font-medium">
                                                        {job.status === 'processing' ? (job.current_node ? `Executing: ${job.current_node}` : 'Generating...') : 'Pending'}
                                                    </span>
                                                    {job.status === 'processing' && job.progress && (
                                                        <div className="w-full mt-4">
                                                            <ProgressViz
                                                                progress={job.progress}
                                                                etaSeconds={computeEtaSeconds(job, workflowsById, state.workflow_info)}
                                                                size="sm"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {job.status === 'processing' && !job.progress && (
                                                <div className="absolute bottom-0 left-0 right-0 p-2">
                                                    <ProgressViz progress={null} currentNode={job.current_node} size="sm" />
                                                </div>
                                            )}
                                        </div>

                                        {(() => {
                                            const prompt = getDisplayPrompt(job);
                                            return (
                                                <p className="text-xs text-slate-300 line-clamp-2 italic leading-relaxed">
                                                    {prompt ? `"${prompt}"` : <span className="text-muted not-italic">no prompt</span>}
                                                </p>
                                            );
                                        })()}

                                        <div className="flex items-center justify-between pt-2 border-t border-border/30 gap-2">
                                            {(() => {
                                                const color = getUserColor(job.user_id);
                                                return (
                                                    <div className="flex items-center space-x-1.5 overflow-hidden" title={`User: ${job.user_id || 'anonymous'}`}>
                                                        <div
                                                            className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/30"
                                                            style={{ backgroundColor: color.dot }}
                                                        />
                                                        <span
                                                            className="text-[10px] truncate font-medium"
                                                            style={{ color: color.ring }}
                                                        >
                                                            {job.user_id === username ? 'You' : job.user_id}
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                            <WorkflowChip workflowId={job.workflow_id} workflowsById={workflowsById} />
                                        </div>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                    );
                    })()}
                </div>
            </div>

            {/* My Jobs Sidebar - Desktop */}
            <div className="w-80 border-l border-border hidden xl:block shrink-0">
                <MyJobsPanel />
            </div>

            <ConfirmDialog
                isOpen={!!pendingAction}
                title={pendingAction?.title || ''}
                message={pendingAction?.message || ''}
                confirmLabel={pendingAction?.kind === 'cancel' ? 'Yes, cancel job' : 'Yes, delete'}
                requirePassword={pendingAction && !pendingAction.isMine}
                passwordHint={pendingAction && !pendingAction.isMine
                    ? `${pendingAction.userId}'s job — admin password required. If no password is set, this action is disabled.`
                    : null}
                onClose={() => setPendingAction(null)}
                onConfirm={(pw) => {
                    if (!pendingAction) return;
                    const { jobId, kind } = pendingAction;
                    if (kind === 'cancel') cancelJob(jobId, pw);
                    else deleteJob(jobId, pw);
                    setPendingAction(null);
                }}
            />

            {/* My Jobs Sidebar - Mobile Overlay */}
            {
                isMyJobsOpen && (
                    <div className="fixed inset-0 z-50 flex justify-end xl:hidden">
                        <div
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                            onClick={() => setIsMyJobsOpen(false)}
                        />
                        <div className="relative w-72 sm:w-80 h-full animate-in slide-in-from-right duration-300">
                            <MyJobsPanel onClose={() => setIsMyJobsOpen(false)} />
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default SchedulerPage;
