import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.css';
import { useSocket } from '../context/SocketContext';
import { Clock, Tag, Image as ImageIcon, Sparkles, AlertCircle, CheckCircle2, User, Download, X, Crosshair, Users, Search, ChevronDown, ChevronRight, Layers, Monitor } from 'lucide-react';
import BookingDialog from '../components/BookingDialog';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import MyJobsPanel from '../components/MyJobsPanel';
import JobCard from '../components/JobCard';
import { useInView } from '../hooks/useInView';
import ImageLightbox from '../components/ImageLightbox';
import MediaPreview from '../components/ui/MediaPreview';
import WorkflowChip from '../components/ui/WorkflowChip';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ProgressViz from '../components/ui/ProgressViz';
import { getImageUrl, getDownloadUrl } from '../utils/api';
import { getUserColor } from '../utils/userColor';
import { getDisplayPrompt, getPrimaryDownloadFilename, getGenerationMs, formatDuration, getJobText } from '../utils/jobDisplay';
import { computeEtaSeconds } from '../utils/jobEta';
import PromptGuideLinks from '../components/PromptGuideLinks';
import WorkflowInfoCard from '../components/WorkflowInfoCard';

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
// Cards mounted per batch in the results grid (see cardLimit below).
const CARD_PAGE = 60;
const WINDOW_BEFORE_MS = 10 * 60 * 1000;
const WINDOW_AFTER_MS = 50 * 60 * 1000;
const FOLLOW_TICK_MS = 10 * 1000;

const SchedulerPage = () => {
    const { state, bookJob, deleteJob, cancelJob, reorderJob, username, workflowsById, scopedWorkflowId } = useSocket();
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
    // Live Schedule (timeline) collapse — collapsed by default; a student's choice
    // is persisted (stores '0' once they expand), so it only stays open if they
    // explicitly opened it. The timeline DOM stays mounted while collapsed
    // (CSS-hidden) so the vis-timeline instance keeps its node; we redraw() on expand.
    const [scheduleCollapsed, setScheduleCollapsed] = useState(
        () => localStorage.getItem('comfyq.scheduleCollapsed') !== '0'
    );
    const toggleSchedule = () => setScheduleCollapsed((v) => {
        const next = !v;
        try { localStorage.setItem('comfyq.scheduleCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
        return next;
    });

    // ---- lanes: one queue per model this machine serves -------------------
    // A machine can serve several models at once, each with its OWN queue, and
    // the timeline used to draw every lane's jobs on one track with the main
    // lane's duration — two parallel queues read as one overlapping mess. Now
    // the tab's own lane is the timeline (a tab books exactly one model), and
    // "All lanes" shows one row per lane.
    const lanes = useMemo(() => state.lanes || [], [state.lanes]);
    const multiLane = lanes.length > 1;
    const laneKey = lanes.map(l => l.workflow_id).join('|');
    const myLaneId = useMemo(() => {
        if (!lanes.length) return state.workflow_info?.id || null;
        const scoped = scopedWorkflowId && lanes.find(l => l.workflow_id === scopedWorkflowId);
        return (scoped || lanes.find(l => l.primary) || lanes[0]).workflow_id;
    }, [lanes, scopedWorkflowId, state.workflow_info?.id]);
    const laneLabel = (l) => l?.title || l?.name || l?.workflow_id || '';
    const [showAllLanes, setShowAllLanes] = useState(() => {
        try { return localStorage.getItem('comfyq.showAllLanes') === '1'; } catch { return false; }
    });
    const toggleAllLanes = () => setShowAllLanes(v => {
        try { localStorage.setItem('comfyq.showAllLanes', v ? '0' : '1'); } catch { /* ignore */ }
        return !v;
    });
    // The results grid can be narrowed to one model too ('all' = every job).
    const [modelFilter, setModelFilter] = useState('all');
    // Each job's bar is as long as ITS model takes, not the main lane's.
    const durationMsOf = useCallback((job) => {
        const sec = workflowsById?.[job.workflow_id]?.estimatedDurationSec
            || lanes.find(l => l.workflow_id === job.workflow_id)?.estimatedDurationSec;
        return sec ? sec * 1000 : (state.benchmark_ms || 60000);
    }, [workflowsById, lanes, state.benchmark_ms]);
    // Per-lane queue status for the header strip.
    const laneQueues = useMemo(() => lanes.map(l => {
        const own = (state.jobs || []).filter(j => j.workflow_id === l.workflow_id);
        const waiting = own.filter(j => j.status === 'scheduled');
        const running = own.find(j => j.status === 'processing');
        const waitMs = waiting.reduce((t, j) => t + durationMsOf(j), 0);
        return { lane: l, waiting: waiting.length, running: !!running || !!l.busy, waitMs };
    }), [lanes, state.jobs, durationMsOf]);

    const reuseJob = (job) => {
        setPrefillParams(job.params || {});
        // No slot picked → run ASAP (null time). The server drops it into the
        // next free slot in the queue.
        setBookingTime(null);
        setIsBookingOpen(true);
    };

    // Use refs to keep track of latest state for timeline callbacks without recreating the timeline
    const stateRef = useRef(state);
    const usernameRef = useRef(username);
    const followNowRef = useRef(followNow);
    const myLaneIdRef = useRef(myLaneId);
    useEffect(() => { myLaneIdRef.current = myLaneId; }, [myLaneId]);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    useEffect(() => {
        followNowRef.current = followNow;
    }, [followNow]);

    // Filtering/sorting runs only when the inputs change, not on every
    // broadcast; JobCard is memoized so unchanged cards don't re-render.
    const visibleJobs = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return state.jobs
            .filter((job) => {
                if (activeTab === 'mine' && job.user_id !== username) return false;
                if (modelFilter !== 'all' && job.workflow_id !== modelFilter) return false;
                if (activeTab === 'all' && userFilter !== 'all' && job.user_id !== userFilter) return false;
                if (q) {
                    // Search the resolved display prompt so jobs whose headline
                    // `prompt` was empty (LTX-style with positive_prompt) still
                    // match what the user actually typed.
                    const prompt = getDisplayPrompt(job).toLowerCase();
                    const user = (job.user_id || '').toLowerCase();
                    if (!prompt.includes(q) && !user.includes(q)) return false;
                }
                return true;
            })
            .sort((a, b) => b.time_slot - a.time_slot);
    }, [state.jobs, activeTab, userFilter, searchQuery, username, modelFilter]);

    // How many cards are mounted at once. A workshop's history runs into the
    // hundreds and every card carries media, so mounting them all is what made
    // the grid slow to open and heavy to scroll; the rest follow as the student
    // reaches the bottom.
    const [cardLimit, setCardLimit] = useState(CARD_PAGE);
    useEffect(() => { setCardLimit(CARD_PAGE); }, [activeTab, userFilter, searchQuery, modelFilter]);
    const shownJobs = useMemo(() => visibleJobs.slice(0, cardLimit), [visibleJobs, cardLimit]);
    const hasMoreCards = visibleJobs.length > shownJobs.length;
    const [moreRef, moreInView] = useInView({ rootMargin: '600px' });
    useEffect(() => {
        if (moreInView && hasMoreCards) setCardLimit(n => n + CARD_PAGE);
    }, [moreInView, hasMoreCards, shownJobs.length]);

    // The model this tab is for. A machine can serve several at once, but each
    // tab is opened for one of them (…/user?workflow=<id>, how the fleet monitor
    // opens them), so only that one is announced here.
    const servedModels = useMemo(() => {
        const lanes = state.lanes || [];
        const asModel = l => ({
            id: l.workflow_id, name: l.name, title: l.title, summary: l.summary, description: l.description,
            category: l.category, promptGuides: l.promptGuides, busy: l.busy,
        });
        if (lanes.length) {
            const scoped = scopedWorkflowId && lanes.find(l => l.workflow_id === scopedWorkflowId);
            if (scoped) return [asModel(scoped)];
            const primary = lanes.find(l => l.primary) || lanes[0];
            return [asModel(primary)];
        }
        return state.workflow_info?.id ? [state.workflow_info] : [];
    }, [state.lanes, state.workflow_info, scopedWorkflowId]);

    // The card's example job (user "examples", seeded from the test suite).
    const exampleFor = useCallback((workflowId) => (state.jobs || []).find(j =>
        j.user_id === 'examples' && j.workflow_id === workflowId && j.status === 'completed') || null, [state.jobs]);

    const openJob = useCallback((job) => {
        setSelectedJob(job);
        if (job.status === 'completed') setLightboxJob(job);
    }, []);

    const openBooking = useCallback(() => {
        setBookingTime(null);
        setIsBookingOpen(true);
    }, []);

    const closeBooking = useCallback(() => {
        setIsBookingOpen(false);
        setPrefillParams(null);
    }, []);

    const confirmBooking = useCallback(({ prompt, params, time, workflowId }) => bookJob(time, prompt, params, workflowId), [bookJob]);

    // A recalled parameter set belongs to the workflow it came from; drop it
    // when the machine starts serving another one so the booking form doesn't
    // prefill values the new workflow has no use for.
    const servedWorkflowId = state.workflow_info?.id;
    useEffect(() => { setPrefillParams(null); }, [servedWorkflowId]);

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
                callback(null); // Don't add directly, wait for server
                // In "All lanes", a double-click on ANOTHER model's row would
                // book this tab's model at that time — on the wrong row. Say so.
                if (item.group && item.group !== myLaneIdRef.current) {
                    window.alert('This tab books the model on the highlighted row. To book another model, open it from its row in the header (or from the Discovery app).');
                    return;
                }
                setBookingTime(item.start.getTime());
                setIsBookingOpen(true);
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
            zoomMax: 1000 * 60 * 60 * 24, // 24 hours
            // Only zoom on mouse-wheel when Ctrl is held. Without this, scrolling
            // the page while the cursor is over the timeline is "caught" (zooms
            // the schedule instead of scrolling the page). With a zoomKey set,
            // vis-timeline lets a plain wheel event through to the page.
            zoomKey: 'ctrlKey'
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

    // When the schedule is expanded after being collapsed, the timeline was laid
    // out inside a display:none box (0×0 — no resize event fires on un-hide), so
    // tell vis-timeline to recompute its size and re-center on "now".
    useEffect(() => {
        if (scheduleCollapsed || !timelineRef.current) return;
        const id = requestAnimationFrame(() => {
            if (!timelineRef.current) return;
            timelineRef.current.redraw();
            if (followNowRef.current) slideToNow();
        });
        return () => cancelAnimationFrame(id);
    }, [scheduleCollapsed]);

    // One timeline row per lane in "All lanes" (this tab's lane first), plus a
    // row for jobs of models the machine no longer serves. Set BEFORE the items
    // effect below runs, so items arrive with their group already known.
    useEffect(() => {
        const tl = timelineRef.current;
        if (!tl) return;
        if (multiLane && showAllLanes) {
            const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            const groups = lanes.map((l, i) => ({
                id: l.workflow_id,
                order: l.workflow_id === myLaneId ? -1 : i,
                className: l.workflow_id === myLaneId ? 'vis-group-mine' : '',
                content: `<span class="text-[11px] font-semibold">${esc(laneLabel(l))}</span>${l.workflow_id === myLaneId ? '<br><span class="text-[9px] uppercase tracking-wider opacity-70">this tab</span>' : ''}`,
            }));
            groups.push({ id: '__other', order: 999, content: '<span class="text-[10px] opacity-70">earlier models</span>' });
            tl.setGroups(new DataSet(groups));
        } else {
            tl.setGroups(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [multiLane, showAllLanes, laneKey, myLaneId]);

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
            const servedIds = new Set(lanes.map(l => l.workflow_id));
            const grouped = multiLane && showAllLanes;
            // With several lanes, the tab's own queue unless "All lanes" is on.
            const timelineJobs = multiLane && !showAllLanes
                ? state.jobs.filter(j => j.workflow_id === myLaneId)
                : state.jobs;
            const itemsData = timelineJobs.map(job => {
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
                    end: new Date(job.time_slot + durationMsOf(job)),
                    ...(grouped ? { group: servedIds.has(job.workflow_id) ? job.workflow_id : '__other' } : {}),
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
            const newIds = new Set(itemsData.map(i => i.id));

            // Remove items not in the new list
            const toRemove = existingIds.filter(id => !newIds.has(id));
            if (toRemove.length > 0) itemsRef.current.remove(toRemove);

            // Update or add items
            itemsRef.current.update(itemsData);
        }
    }, [state.jobs, state.benchmark_ms, username, multiLane, showAllLanes, myLaneId, laneKey, durationMsOf]);

    // Upcoming jobs waiting in the queue (status 'scheduled' = not yet run). Shown
    // as a count next to the header when the Live Schedule is collapsed, so the
    // room still sees how busy the queue is without expanding the timeline.
    const scheduledCount = (state.jobs || []).filter((j) => j.status === 'scheduled'
        && (!multiLane || j.workflow_id === myLaneId)).length;
    const myLaneName = laneLabel(lanes.find(l => l.workflow_id === myLaneId)) || state.workflow_info?.name || '';
    const fmtWait = (ms) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`);

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
                        <p className="text-muted text-sm sm:text-base mt-1">
                            Hello, <span className="text-primary font-bold">{username}</span>. Plan your generations
                            {state.machine?.name && (
                                <> on <span className="inline-flex items-center gap-1 font-semibold text-foreground" title={state.machine.gpu || ''}>
                                    <Monitor size={14} className="text-primary" />{state.machine.name}
                                </span></>
                            )}.
                        </p>
                        {/* One queue per model this machine serves: which one this tab
                            books, how busy each is, and a link to book the others. */}
                        {multiLane && (
                            <div className="mt-2 flex flex-wrap gap-2 max-w-3xl">
                                {laneQueues.map(({ lane: l, waiting, running, waitMs }) => {
                                    const mine = l.workflow_id === myLaneId;
                                    const body = (
                                        <>
                                            <Layers size={12} className={mine ? 'text-primary' : 'text-muted'} />
                                            <span className="font-semibold truncate max-w-[16rem]">{laneLabel(l)}</span>
                                            <span className={running ? 'text-success' : 'text-muted'}>{running ? 'generating' : 'idle'}</span>
                                            <span className="text-muted">· {waiting} waiting{waiting ? ` (~${fmtWait(waitMs)})` : ''}</span>
                                            {mine && <span className="text-[9px] uppercase tracking-wider text-primary font-bold">this tab</span>}
                                        </>
                                    );
                                    const cls = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${mine ? 'border-primary/50 bg-primary/10' : 'border-border bg-surface hover:border-primary/40'}`;
                                    return mine ? (
                                        <span key={l.workflow_id} className={cls}>{body}</span>
                                    ) : (
                                        <a key={l.workflow_id} className={cls}
                                            href={`/user?workflow=${encodeURIComponent(l.workflow_id)}`}
                                            target="_blank" rel="noopener noreferrer"
                                            title="Open this model's own booking page in a new tab">
                                            {body}
                                        </a>
                                    );
                                })}
                            </div>
                        )}
                        {/* What this machine is serving. It can run several models at
                            once, each in its own lane with its own queue — so list them
                            all, not just the first, or the others are invisible until
                            the booking form is opened. */}
                        {servedModels.map((wf, i) => (
                            <WorkflowInfoCard key={wf.id || i} wf={wf} className="mt-2 max-w-2xl"
                                example={exampleFor(wf.id)} onOpenExample={setLightboxJob} />
                        ))}
                    </div>
                    <div className="flex items-center space-x-2 sm:space-x-4">
                        <Button
                            variant="primary"
                            size="lg"
                            icon={Sparkles}
                            // No slot → ASAP (null). Double-clicking the timeline
                            // still books an explicit slot.
                            onClick={openBooking}
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

                <div className="space-y-3 px-4 sm:px-12 lg:px-20">
                    <div className="flex items-center justify-between gap-3 ml-1">
                        <div className="flex items-center gap-2.5">
                            <button
                                type="button"
                                onClick={toggleSchedule}
                                className="flex items-center gap-1.5 text-sm font-semibold text-muted uppercase tracking-widest hover:text-foreground transition-colors"
                                aria-expanded={!scheduleCollapsed}
                                title={scheduleCollapsed ? 'Show the live schedule' : 'Hide the live schedule'}
                            >
                                {scheduleCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                Live Schedule
                            </button>
                            {multiLane && (
                                <button type="button" onClick={toggleAllLanes}
                                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${showAllLanes ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted hover:text-foreground'}`}
                                    title={showAllLanes ? 'Show only the queue of the model this tab books' : 'Show every model’s queue, one row each'}>
                                    {showAllLanes ? 'All lanes' : `Only ${myLaneName}`}
                                </button>
                            )}
                            {scheduleCollapsed && (
                                scheduledCount > 0 ? (
                                    <Badge variant="primary" className="text-[10px] py-0.5">
                                        {scheduledCount} upcoming job{scheduledCount === 1 ? '' : 's'}{multiLane ? ' in this lane' : ''}
                                    </Badge>
                                ) : (
                                    <span className="text-[10px] text-muted/70 normal-case tracking-normal">
                                        No jobs scheduled
                                    </span>
                                )
                            )}
                        </div>
                        {!scheduleCollapsed && (
                            <span className="text-[10px] text-muted/70 normal-case tracking-normal hidden sm:inline">
                                Ctrl + scroll to zoom · drag to pan
                            </span>
                        )}
                    </div>
                    {/* Kept mounted (CSS-hidden) when collapsed so the vis-timeline
                        instance keeps its DOM node; the effect above redraws on expand. */}
                    <Card className={`flex-none border-slate-700/50 bg-background/50 shadow-inner ${scheduleCollapsed ? 'hidden' : ''}`} noPadding>
                        <div ref={containerRef} className={`${multiLane && showAllLanes ? 'h-[220px] sm:h-[260px]' : 'h-[140px] sm:h-[170px]'} w-full`} />
                    </Card>
                </div>

                <BookingDialog
                    isOpen={isBookingOpen}
                    onClose={closeBooking}
                    initialTime={bookingTime}
                    initialParams={prefillParams}
                    onConfirm={confirmBooking}
                />

                <ImageLightbox
                    isOpen={!!lightboxJob}
                    onClose={() => setLightboxJob(null)}
                    job={lightboxJob}
                    onReuse={reuseJob}
                    activeWorkflowId={state.workflow_info?.id}
                />

                <div className="space-y-6 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-border">
                            <button
                                onClick={() => setActiveTab('mine')}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${activeTab === 'mine' ? 'bg-primary text-on-primary shadow' : 'text-muted hover:text-white'}`}
                            >
                                My Generations
                            </button>
                            <button
                                onClick={() => setActiveTab('all')}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${activeTab === 'all' ? 'bg-primary text-on-primary shadow' : 'text-muted hover:text-white'}`}
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
                            {/* By model: a lane's queue and results on their own, or one
                                card's examples among the whole library's. */}
                            {(() => {
                                const ids = Array.from(new Set(state.jobs.map(j => j.workflow_id).filter(Boolean)));
                                if (ids.length < 2 && modelFilter === 'all') return null;
                                const nameOf = (id) => workflowsById?.[id]?.title || workflowsById?.[id]?.name || laneLabel(lanes.find(l => l.workflow_id === id)) || id;
                                const opts = ids.map(id => ({ id, label: nameOf(id), n: state.jobs.filter(j => j.workflow_id === id).length }))
                                    .sort((x, y) => x.label.localeCompare(y.label));
                                return (
                                    <div className="flex items-center gap-2">
                                        <Layers size={14} className="text-muted" />
                                        <select
                                            value={modelFilter}
                                            onChange={(e) => setModelFilter(e.target.value)}
                                            className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs text-white max-w-[16rem]"
                                            title="Show the jobs of one model only"
                                        >
                                            <option value="all">All models</option>
                                            {opts.map(o => <option key={o.id} value={o.id}>{o.label} — {o.n}</option>)}
                                        </select>
                                    </div>
                                );
                            })()}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                        {visibleJobs.length === 0 ? (
                            <div className="col-span-full py-12 flex flex-col items-center justify-center text-center space-y-4 opacity-30">
                                <Clock size={48} />
                                <p className="text-lg font-medium">
                                    {searchQuery.trim()
                                        ? `No jobs match "${searchQuery}"`
                                        : activeTab === 'mine' ? "You haven't generated anything yet" : 'No jobs match this filter'}
                                </p>
                                {activeTab === 'mine' && !searchQuery.trim() && <Button variant="ghost" onClick={openBooking}>Book your first slot</Button>}
                            </div>
                        ) : (
                            shownJobs.map((job) => (
                                <JobCard
                                    key={job.id}
                                    job={job}
                                    isMine={job.user_id === username}
                                    isSelected={selectedJob?.id === job.id}
                                    workflowsById={workflowsById}
                                    workflowInfo={state.workflow_info}
                                    onOpen={openJob}
                                    onRequestAction={setPendingAction}
                                />
                            ))
                        )}
                        {hasMoreCards && (
                            <div ref={moreRef} className="col-span-full py-6 flex justify-center">
                                <button
                                    onClick={() => setCardLimit(n => n + CARD_PAGE)}
                                    className="text-xs font-medium text-muted hover:text-foreground px-3 py-2 rounded-lg border border-border bg-surface"
                                >
                                    Showing {shownJobs.length} of {visibleJobs.length} — load more
                                </button>
                            </div>
                        )}
                    </div>
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
