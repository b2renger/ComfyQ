import React, { useEffect, useRef, useState } from 'react';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import { useSocket } from '../context/SocketContext';
import { Clock, Tag, Image as ImageIcon, Sparkles, AlertCircle, CheckCircle2, User, Download, X } from 'lucide-react';
import BookingDialog from '../components/BookingDialog';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import MyJobsPanel from '../components/MyJobsPanel';
import ImageLightbox from '../components/ImageLightbox';
import MediaPreview from '../components/ui/MediaPreview';
import { getImageUrl, getDownloadUrl } from '../utils/api';

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
const SchedulerPage = () => {
    const { state, bookJob, deleteJob, reorderJob, username } = useSocket();
    const timelineRef = useRef(null);
    const containerRef = useRef(null);
    const itemsRef = useRef(null); // vis-data DataSet
    const [selectedJob, setSelectedJob] = useState(null);
    const [isBookingOpen, setIsBookingOpen] = useState(false);
    const [bookingTime, setBookingTime] = useState(Date.now());
    const [isMyJobsOpen, setIsMyJobsOpen] = useState(false);
    const [lightboxJob, setLightboxJob] = useState(null);

    // Use refs to keep track of latest state for timeline callbacks without recreating the timeline
    const stateRef = useRef(state);
    const usernameRef = useRef(username);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize DataSet
        const items = new DataSet([]);
        itemsRef.current = items;

        const options = {
            stack: false,
            start: new Date(),
            end: new Date(Date.now() + 3600000), // 1 hour ahead
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

        return () => {
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
            const itemsData = state.jobs.map(job => {
                const isMine = job.user_id === username;
                const shortId = (job.user_id || '???').substring(0, 3).toUpperCase();

                return {
                    id: job.id,
                    content: `<div class="flex items-center space-x-2 w-full truncate">
                                <span class="font-bold text-[10px] opacity-70">${isMine ? 'ME' : shortId}</span>
                                <span class="font-medium text-xs truncate">${job.prompt}</span>
                              </div>`,
                    start: new Date(job.time_slot),
                    end: new Date(job.time_slot + (state.benchmark_ms || 60000)), // Default to 1 min if benchmark not ready
                    className: `${isMine ? 'vis-item-mine' : ''} ${job.status === 'processing' ? 'vis-item-processing' :
                        (job.status === 'completed' ? 'vis-item-completed' : 'vis-item-scheduled')}`,
                    title: `${job.user_id}: ${job.prompt}`,
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

            // Auto-fit if it's the first time we get jobs
            if (state.jobs.length > 0 && existingIds.length === 0 && timelineRef.current) {
                timelineRef.current.fit();
            }
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
                            variant="secondary"
                            size="sm"
                            onClick={() => timelineRef.current && timelineRef.current.fit()}
                            title="Auto-fit timeline to show all jobs"
                        >
                            Fit View
                        </Button>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted uppercase tracking-widest ml-1">Live Schedule</h3>
                    <Card className="flex-none border-slate-700/50 bg-background/50 shadow-inner" noPadding>
                        <div ref={containerRef} className="h-[300px] sm:h-[400px] w-full" />
                    </Card>
                </div>

                <BookingDialog
                    isOpen={isBookingOpen}
                    onClose={() => setIsBookingOpen(false)}
                    initialTime={bookingTime}
                    onConfirm={({ prompt, params, time }) => bookJob(time || bookingTime, prompt, params)}
                />

                <ImageLightbox
                    isOpen={!!lightboxJob}
                    onClose={() => setLightboxJob(null)}
                    job={lightboxJob}
                />

                <div className="space-y-6 pt-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-muted uppercase tracking-widest ml-1">Recent Generations</h3>
                        <span className="text-xs text-muted">{state.jobs.length} total jobs</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                        {state.jobs.length === 0 ? (
                            <div className="col-span-full py-12 flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                                <Clock size={48} />
                                <p className="text-lg font-medium">No jobs scheduled yet</p>
                                <Button variant="ghost" onClick={() => setIsBookingOpen(true)}>Book the first slot</Button>
                            </div>
                        ) : (
                            state.jobs.sort((a, b) => b.time_slot - a.time_slot).map((job) => (
                                <Card
                                    key={job.id}
                                    className={`group relative overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-pointer ${selectedJob?.id === job.id ? 'ring-2 ring-primary border-primary/50' : 'hover:border-primary/30'}`}
                                    onClick={() => {
                                        setSelectedJob(job);
                                        if (job.status === 'completed') setLightboxJob(job);
                                    }}
                                >
                                    {job.user_id === username && (
                                        <div className="absolute top-0 right-0 flex items-center">
                                            {job.status === 'scheduled' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm("Cancel this job?")) deleteJob(job.id);
                                                    }}
                                                    className="p-1.5 bg-danger/10 text-danger hover:bg-danger hover:text-white transition-colors rounded-bl-lg border-l border-b border-danger/20"
                                                    title="Cancel Job"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                            <div className="p-1 px-2 bg-primary/20 text-primary text-[8px] font-bold uppercase tracking-tighter rounded-bl-lg border-l border-b border-primary/20">
                                                Yours
                                            </div>
                                        </div>
                                    )}

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
                                                        <div className="w-full mt-4 space-y-1">
                                                            <div className="flex justify-between text-[8px] font-mono text-primary/70">
                                                                <span>Step {job.progress.value} of {job.progress.max}</span>
                                                                {job.s_it && <span>{job.s_it} s/it</span>}
                                                                <span>{Math.round((job.progress.value / job.progress.max) * 100)}%</span>
                                                            </div>
                                                            <div className="w-full bg-surface h-1 rounded-full overflow-hidden border border-border/50">
                                                                <div
                                                                    className="h-full bg-primary transition-all duration-300 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
                                                                    style={{ width: `${(job.progress.value / job.progress.max) * 100}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {job.status === 'processing' && !job.progress && (
                                                <div className="absolute bottom-0 left-0 right-0 p-2">
                                                    {job.current_node && <p className="text-[8px] text-primary/50 mb-1">Node: {job.current_node}</p>}
                                                    <div className="w-full bg-muted/10 h-1 rounded-full overflow-hidden">
                                                        <div className="h-full bg-primary animate-progress-indeterminate shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <p className="text-xs text-slate-300 line-clamp-2 italic leading-relaxed">
                                            "{job.prompt}"
                                        </p>

                                        <div className="flex items-center justify-between pt-2 border-t border-border/30">
                                            <div className="flex items-center space-x-1.5 overflow-hidden">
                                                <div className="w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center shrink-0">
                                                    <User size={10} className="text-muted" />
                                                </div>
                                                <span className="text-[10px] text-muted truncate">{job.user_id === username ? 'You' : job.user_id}</span>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* My Jobs Sidebar - Desktop */}
            <div className="w-80 border-l border-border hidden xl:block shrink-0">
                <MyJobsPanel />
            </div>

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
