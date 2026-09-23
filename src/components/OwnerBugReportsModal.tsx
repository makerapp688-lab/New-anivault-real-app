import React, { useState, useEffect } from 'react';
import {
  X,
  Bug,
  Shield,
  Filter,
  RefreshCw,
  Clock,
  User,
  Monitor,
  Globe,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Film,
  Image as ImageIcon,
  Download,
  Loader2,
  ChevronRight,
  MessageSquare
} from 'lucide-react';
import { BugReport, BugReportStatus } from '../../server/bug-reports.ts';

interface OwnerBugReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionToken?: string;
}

export const OwnerBugReportsModal: React.FC<OwnerBugReportsModalProps> = ({
  isOpen,
  onClose,
  sessionToken
}) => {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'All' | BugReportStatus>('All');
  const [selectedReport, setSelectedReport] = useState<BugReport | null>(null);

  // Status edit state
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);
  const [internalNoteInput, setInternalNoteInput] = useState<string>('');
  const [savingNote, setSavingNote] = useState<boolean>(false);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);

  const token = sessionToken || localStorage.getItem('anivault_owner_token') || '';

  const fetchReports = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/bug-reports/owner/list', {
        headers: {
          'X-Owner-Session': token
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch bug reports.');
      }

      setReports(data.reports || []);
      // If a report was selected, refresh its data in selection
      if (selectedReport) {
        const updated = (data.reports || []).find((r: BugReport) => r.id === selectedReport.id);
        if (updated) {
          setSelectedReport(updated);
          setInternalNoteInput(updated.internalNotes || '');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error connecting to Owner Bug Reports API.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchReports();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'All') return true;
    return r.status === statusFilter;
  });

  const handleSelectReport = (report: BugReport) => {
    setSelectedReport(report);
    setInternalNoteInput(report.internalNotes || '');
    setUpdateSuccess(null);
  };

  const handleUpdateStatus = async (newStatus: BugReportStatus) => {
    if (!selectedReport) return;
    setUpdatingStatus(true);
    setUpdateSuccess(null);

    try {
      const res = await fetch(`/api/bug-reports/owner/report/${selectedReport.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Session': token
        },
        body: JSON.stringify({ status: newStatus })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status.');

      setSelectedReport(data.report);
      setReports((prev) =>
        prev.map((r) => (r.id === data.report.id ? data.report : r))
      );
      setUpdateSuccess(`Status updated to '${newStatus}'`);
      setTimeout(() => setUpdateSuccess(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSaveInternalNote = async () => {
    if (!selectedReport) return;
    setSavingNote(true);
    setUpdateSuccess(null);

    try {
      const res = await fetch(`/api/bug-reports/owner/report/${selectedReport.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Session': token
        },
        body: JSON.stringify({ internalNote: internalNoteInput })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save internal note.');

      setSelectedReport(data.report);
      setReports((prev) =>
        prev.map((r) => (r.id === data.report.id ? data.report : r))
      );
      setUpdateSuccess('Internal owner note saved');
      setTimeout(() => setUpdateSuccess(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSavingNote(false);
    }
  };

  const getStatusBadge = (status: BugReportStatus) => {
    switch (status) {
      case 'New':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 uppercase">
            New
          </span>
        );
      case 'Investigating':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
            Investigating
          </span>
        );
      case 'Fixed':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 uppercase">
            Fixed
          </span>
        );
      case 'Closed':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 uppercase">
            Closed
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className="relative w-full max-w-5xl my-auto bg-slate-950 border-2 border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-amber-500/30 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white tracking-wide uppercase">
                  BUG REPORT DASHBOARD
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  OWNER ONLY
                </span>
              </div>
              <p className="text-xs text-amber-300/80">
                Manage user feedback, inspect attachments, and assign status updates
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchReports}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/30 transition-colors cursor-pointer"
              title="Refresh Bug Reports"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dashboard Main Content (Master-Detail Grid) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Column: Report List (5 cols on desktop) */}
          <div className={`lg:col-span-5 border-r border-slate-800 flex flex-col min-h-0 ${selectedReport ? 'hidden lg:flex' : 'flex'}`}>
            {/* Status Filter Bar */}
            <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
              {(['All', 'New', 'Investigating', 'Fixed', 'Closed'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {st}
                  {st === 'New' && (
                    <span className="ml-1.5 px-1.5 py-0.2 text-[10px] rounded-full bg-rose-600 text-white font-bold">
                      {reports.filter((r) => r.status === 'New').length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {isLoading ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-amber-400" />
                  <p className="text-xs">Loading bug reports...</p>
                </div>
              ) : errorMsg ? (
                <div className="p-4 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300 space-y-1">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <p>{errorMsg}</p>
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/50" />
                  <p className="text-xs font-medium">No bug reports in this view.</p>
                </div>
              ) : (
                filteredReports.map((report) => {
                  const isSelected = selectedReport?.id === report.id;
                  return (
                    <div
                      key={report.id}
                      onClick={() => handleSelectReport(report)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-950/40 border-amber-500/80 shadow-md ring-1 ring-amber-500/30'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-mono font-bold text-amber-400 truncate">
                          {report.id}
                        </span>
                        {getStatusBadge(report.status)}
                      </div>

                      <h4 className="text-xs font-bold text-white line-clamp-1">
                        {report.whatHappened}
                      </h4>

                      <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                        Trying: {report.whatWereYouTryingToDo}
                      </p>

                      <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {new Date(report.createdAt).toLocaleDateString()}
                          </span>
                          {report.attachment && (
                            <span className="flex items-center gap-0.5 text-rose-400 font-semibold">
                              {report.attachment.fileType.includes('video') ? (
                                <Film className="w-3 h-3" />
                              ) : (
                                <ImageIcon className="w-3 h-3" />
                              )}
                              Media
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-slate-400">
                          <span>{report.diagnostics.relevantFeature}</span>
                          <ChevronRight className="w-3 h-3" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Detailed View (7 cols on desktop) */}
          <div className={`lg:col-span-7 flex flex-col min-h-0 bg-slate-900/50 ${!selectedReport ? 'hidden lg:flex' : 'flex'}`}>
            {selectedReport ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
                {/* Mobile back button */}
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className="lg:hidden text-xs font-bold text-amber-400 flex items-center gap-1 cursor-pointer"
                >
                  ← Back to Reports List
                </button>

                {updateSuccess && (
                  <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-xs text-emerald-300 font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{updateSuccess}</span>
                  </div>
                )}

                {/* Report Header Card */}
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] text-slate-500 font-mono block">REPORT ID</span>
                      <span className="text-sm font-black font-mono text-amber-400">{selectedReport.id}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block mb-0.5">CURRENT STATUS</span>
                      {getStatusBadge(selectedReport.status)}
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono pt-2 border-t border-slate-800/80">
                    <span>Submitted: {new Date(selectedReport.createdAt).toLocaleString()}</span>
                    <span>User: {selectedReport.diagnostics.userType} ({selectedReport.diagnostics.accountId || 'Guest'})</span>
                  </div>
                </div>

                {/* Reporter Profile Section */}
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {selectedReport.reporterProfile?.avatar ? (
                      <img
                        src={selectedReport.reporterProfile.avatar}
                        alt="Reporter Avatar"
                        className="w-10 h-10 rounded-full object-cover border border-amber-500/40"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 font-black text-sm">
                        {(selectedReport.reporterProfile?.username || selectedReport.diagnostics.accountId || 'G')[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {selectedReport.reporterProfile?.username || 'Guest User'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-500/10 text-amber-300 border border-amber-500/30">
                          {selectedReport.reporterProfile?.role || selectedReport.diagnostics.userType}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {selectedReport.reporterProfile?.email || 'No email associated (Guest Session)'}
                      </p>
                    </div>
                  </div>

                  <div className="text-right text-[10px] font-mono text-slate-500 hidden sm:block">
                    <span>Account ID: {selectedReport.diagnostics.accountId || 'Guest'}</span>
                  </div>
                </div>

                {/* Status Update Control */}
                <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                  <label className="text-xs font-bold text-slate-200">Change Report Status:</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['New', 'Investigating', 'Fixed', 'Closed'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={updatingStatus || selectedReport.status === st}
                        onClick={() => handleUpdateStatus(st)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          selectedReport.status === st
                            ? 'bg-amber-500 text-slate-950 shadow-md'
                            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question 1: What happened */}
                <div className="space-y-1">
                  <h5 className="text-xs font-bold text-rose-400 uppercase tracking-wider">What Happened?</h5>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {selectedReport.whatHappened}
                  </div>
                </div>

                {/* Question 2: What were they trying to do */}
                <div className="space-y-1">
                  <h5 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">What Were They Trying To Do?</h5>
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {selectedReport.whatWereYouTryingToDo}
                  </div>
                </div>

                {/* Question 3: Additional Details */}
                {selectedReport.additionalDetails && (
                  <div className="space-y-1">
                    <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Additional Details</h5>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {selectedReport.additionalDetails}
                    </div>
                  </div>
                )}

                {/* Attachment View */}
                {selectedReport.attachment && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        {selectedReport.attachment.fileType.includes('video') ? (
                          <Film className="w-4 h-4 text-rose-400" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-emerald-400" />
                        )}
                        <span>Attached Screenshot / Video</span>
                      </h5>

                      <a
                        href={`/api/bug-reports/owner/attachment/${selectedReport.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download / Fullview</span>
                      </a>
                    </div>

                    <div className="p-3 bg-black rounded-xl border border-slate-800 flex flex-col items-center justify-center overflow-hidden">
                      {selectedReport.attachment.fileType.includes('video') ? (
                        <video
                          src={`/api/bug-reports/owner/attachment/${selectedReport.id}`}
                          controls
                          className="max-h-64 w-full object-contain rounded-lg"
                        />
                      ) : (
                        <img
                          src={`/api/bug-reports/owner/attachment/${selectedReport.id}`}
                          alt="Bug report screenshot"
                          className="max-h-64 w-full object-contain rounded-lg"
                        />
                      )}
                      <span className="text-[10px] text-slate-500 font-mono mt-2">
                        {selectedReport.attachment.fileName} ({(selectedReport.attachment.fileSize / (1024 * 1024)).toFixed(2)} MB)
                      </span>
                    </div>
                  </div>
                )}

                {/* Diagnostics Grid */}
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <h5 className="font-bold text-slate-300 flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5 text-amber-400" />
                    <span>Auto-Collected System Diagnostics</span>
                  </h5>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                    <div>
                      <span className="text-slate-500 block">App Version:</span>
                      <span className="text-white">{selectedReport.diagnostics.appVersion}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Feature / Route:</span>
                      <span className="text-white">{selectedReport.diagnostics.relevantFeature} ({selectedReport.diagnostics.currentRoute})</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-slate-500 block">Device / User Agent:</span>
                      <span className="text-slate-300 break-all">{selectedReport.diagnostics.devicePlatform}</span>
                    </div>
                  </div>
                </div>

                {/* Internal Owner Notes */}
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <h5 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Internal Owner Notes (Private)</span>
                  </h5>

                  <textarea
                    rows={3}
                    value={internalNoteInput}
                    onChange={(e) => setInternalNoteInput(e.target.value)}
                    placeholder="Add private investigation notes or developer remarks..."
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  />

                  <button
                    type="button"
                    disabled={savingNote}
                    onClick={handleSaveInternalNote}
                    className="py-1.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {savingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    <span>Save Note</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-2">
                <FileText className="w-10 h-10 text-slate-700" />
                <p className="text-sm font-semibold">Select a bug report from the left column to view details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
