import React, { useMemo, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    getSortedRowModel
} from '@tanstack/react-table';
import {
    Users,
    Zap,
    History,
    ChevronUp,
    ChevronDown,
    Activity,
    Server,
    CheckCircle2,
    Settings,
    Trash2
} from 'lucide-react';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import MediaPreview from '../components/ui/MediaPreview';
import { getImageUrl, SERVER_URL } from '../utils/api';

/**
 * Dashboard Page Component
 * 
 * Provides an administrative view of the system's current state.
 * Allows managing the job queue, viewing active users, and monitoring system performance.
 * 
 * Key Features:
 * - Real-time stats (Total jobs, Avg generation time, Active users)
 * - User list with connection status (online/offline indication via Ping)
 * - Sortable job history table (using @tanstack/react-table)
 * - Admin Actions:
 *   - Kill active jobs
 *   - Reorder scheduled jobs
 *   - Filter jobs by user
 *   - Reset server to configuration mode
 */
const DashboardPage = () => {
    const { state, deleteJob, reorderJob } = useSocket();
    const [selectedUser, setSelectedUser] = React.useState(null);

    const handleDeleteJob = (jobId) => {
        if (window.confirm('Are you sure you want to kill this job?')) {
            deleteJob(jobId);
        }
    };

    const handleMoveJob = (jobId, currentTime, delta) => {
        reorderJob(jobId, currentTime + delta);
    };

    const handleResetConfig = async () => {
        if (!window.confirm('Are you sure you want to reset the server to Admin Configuration mode? This will stop all current jobs and restart the server.')) {
            return;
        }

        try {
            await fetch(`${SERVER_URL}/admin/reset-to-admin`, { method: 'POST' });
            // Wait for restart
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (e) {
            console.error(e);
            alert('Failed to reset server');
        }
    };

    // Filter jobs by selected user
    const filteredJobs = useMemo(() => {
        if (!selectedUser) return state.jobs;
        return state.jobs.filter(job => job.user_id === selectedUser);
    }, [state.jobs, selectedUser]);

    const stats = [
        { label: 'Total Jobs Today', value: filteredJobs.length, icon: History, color: 'text-primary' },
        { label: 'Avg Generation Time', value: `${(state.benchmark_ms / 1000).toFixed(1)}s`, icon: Zap, color: 'text-warning' },
        { label: 'Active Users', value: state.connected_users.length, icon: Users, color: 'text-success' },
    ];

    const columns = useMemo(() => [
        {
            header: 'Time',
            accessorKey: 'time_slot',
            cell: info => <div className="font-mono text-xs text-muted">{new Date(info.getValue()).toLocaleTimeString()}</div>,
        },
        {
            header: 'User',
            accessorKey: 'user_id',
            cell: info => (
                <span
                    className="font-medium text-slate-300 cursor-pointer hover:text-primary transition-colors underline decoration-dotted"
                    onClick={() => setSelectedUser(info.getValue())}
                    title="Click to filter jobs by this user"
                >
                    {info.getValue().substring(0, 8)}...
                </span>
            )
        },
        {
            header: 'Status',
            accessorKey: 'status',
            cell: info => (
                <Badge variant={
                    info.getValue() === 'completed' ? 'success' :
                        info.getValue() === 'processing' ? 'warning' : 'default'
                } className="uppercase text-[10px]">
                    {info.getValue()}
                </Badge>
            )
        },
        {
            header: 'Prompt',
            accessorKey: 'prompt',
            cell: info => <div className="max-w-xs truncate text-sm text-slate-400" title={info.getValue()}>{info.getValue()}</div>
        },
        {
            header: 'Result',
            accessorKey: 'result_filename',
            cell: info => info.getValue() ? (
                <div className="w-10 h-10 rounded-lg overflow-hidden border border-border/50 cursor-pointer hover:border-primary transition-colors hover:scale-105 transform duration-200" onClick={() => window.open(getImageUrl(info.getValue()), '_blank')}>
                    <MediaPreview filename={info.getValue()} showPlayIcon={false} />
                </div>
            ) : <div className="w-10 h-10 bg-surface rounded-lg flex items-center justify-center text-[10px] text-muted decoration-dashed">---</div>
        },
        {
            header: 'Actions',
            id: 'actions',
            cell: info => {
                const job = info.row.original;
                const isScheduled = job.status === 'scheduled';
                return (
                    <div className="flex items-center gap-2">
                        {isScheduled && (
                            <>
                                <button
                                    onClick={() => handleMoveJob(job.id, job.time_slot, -state.benchmark_ms)}
                                    className="p-1.5 hover:bg-white/10 rounded text-muted hover:text-white transition-colors"
                                    title="Move Up"
                                >
                                    <ChevronUp size={14} />
                                </button>
                                <button
                                    onClick={() => handleMoveJob(job.id, job.time_slot, state.benchmark_ms)}
                                    className="p-1.5 hover:bg-white/10 rounded text-muted hover:text-white transition-colors"
                                    title="Move Down"
                                >
                                    <ChevronDown size={14} />
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => handleDeleteJob(job.id)}
                            className="p-1.5 hover:bg-danger/20 rounded text-muted hover:text-danger transition-colors"
                            title="Kill Job"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                );
            }
        }
    ], [state.benchmark_ms]);

    const table = useReactTable({
        data: filteredJobs,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        initialState: {
            sorting: [{ id: 'time_slot', desc: true }]
        }
    });

    return (
        <div className="p-6 space-y-8 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">System Dashboard</h2>
                    <p className="text-muted mt-1">Real-time metrics and job history</p>
                </div>
                <button
                    onClick={handleResetConfig}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-white/10 transition-colors text-sm font-medium"
                >
                    <Settings size={16} />
                    Reset Configuration
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {stats.map((stat, i) => (
                    <Card key={i} className="flex items-center space-x-4 border-slate-700/50" hoverEffect>
                        <div className={`p-3 rounded-xl bg-background border border-border/50 ${stat.color}`}>
                            <stat.icon size={24} />
                        </div>
                        <div>
                            <p className="text-sm text-muted font-medium">{stat.label}</p>
                            <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>
                        </div>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* User Table */}
                <Card className="lg:col-span-1 border-slate-700/50" noPadding>
                    <div className="px-6 py-4 border-b border-border bg-surface/50 backdrop-blur-sm sticky top-0">
                        <h3 className="font-semibold flex items-center space-x-2">
                            <Activity size={18} className="text-primary" />
                            <span>Active Connections</span>
                        </h3>
                    </div>
                    <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto">
                        {state.connected_users.map((user) => (
                            <div
                                key={user.socketId}
                                className={`px-6 py-3 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer ${selectedUser === user.userId ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
                                onClick={() => setSelectedUser(user.userId)}
                                title="Click to filter jobs by this user"
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="p-2 bg-background rounded-full">
                                        <Users size={14} className="text-muted" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm text-slate-200">{user.userId.substring(0, 12)}...</p>
                                        <p className="text-[10px] text-muted font-mono">{user.ip}</p>
                                    </div>
                                </div>
                                <span className="flex h-2 w-2 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/75 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                                </span>
                            </div>
                        ))}
                        {state.connected_users.length === 0 && (
                            <div className="p-6 text-center text-muted text-sm italic">No active users</div>
                        )}
                    </div>
                </Card>

                {/* Job List */}
                <Card className="lg:col-span-2 border-slate-700/50" noPadding>
                    <div className="px-6 py-4 border-b border-border bg-surface/50 backdrop-blur-sm flex justify-between items-center sticky top-0">
                        <h3 className="font-semibold flex items-center space-x-2">
                            <Server size={18} className="text-secondary" />
                            <span>Recent Activity</span>
                        </h3>
                        {selectedUser && (
                            <button
                                onClick={() => setSelectedUser(null)}
                                className="text-xs px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg transition-colors flex items-center gap-2"
                            >
                                <span>Viewing: {selectedUser.substring(0, 8)}...</span>
                                <span className="text-primary/70">✕</span>
                            </button>
                        )}
                    </div>
                    <div className="overflow-x-auto max-h-[400px]">
                        <table className="w-full text-left">
                            <thead className="bg-surface/50 text-muted uppercase text-[10px] tracking-widest font-bold sticky top-0 z-10 backdrop-blur-md">
                                {table.getHeaderGroups().map(headerGroup => (
                                    <tr key={headerGroup.id}>
                                        {headerGroup.headers.map(header => (
                                            <th key={header.id} className="px-6 py-3 cursor-pointer select-none hover:text-white transition-colors" onClick={header.column.getToggleSortingHandler()}>
                                                <div className="flex items-center space-x-1">
                                                    <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                                                    {header.column.getIsSorted() === 'asc' && <ChevronUp size={12} />}
                                                    {header.column.getIsSorted() === 'desc' && <ChevronDown size={12} />}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                ))}
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {table.getRowModel().rows.map(row => (
                                    <tr key={row.id} className="hover:bg-white/5 transition-colors group">
                                        {row.getVisibleCells().map(cell => (
                                            <td key={cell.id} className="px-6 py-3 text-sm">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                {filteredJobs.length === 0 && (
                                    <tr>
                                        <td colSpan={columns.length} className="px-6 py-8 text-center text-muted italic">
                                            {selectedUser ? `No jobs found for this user.` : `No jobs recorded yet.`}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default DashboardPage;
