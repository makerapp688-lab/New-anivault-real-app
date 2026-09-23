import React, { useState } from 'react';
import {
  X,
  Bug,
  Upload,
  CheckCircle2,
  AlertCircle,
  Film,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Info
} from 'lucide-react';
import { useUserData } from '../hooks/useUserData.ts';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeFeature?: string;
}

export const BugReportModal: React.FC<BugReportModalProps> = ({
  isOpen,
  onClose,
  activeFeature = 'General Catalogue'
}) => {
  const { account, isGuest } = useUserData();

  const [whatHappened, setWhatHappened] = useState('');
  const [whatWereYouTryingToDo, setWhatWereYouTryingToDo] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');

  // Attachment state
  const [attachment, setAttachment] = useState<{
    file: File;
    previewUrl: string;
    isVideo: boolean;
    base64Data: string;
  } | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (20MB limit)
    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
      setErrorMsg(`Selected file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max limit is ${MAX_MB}MB.`);
      return;
    }

    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');

    if (!isImg && !isVid) {
      setErrorMsg('Please select a valid image (PNG, JPG, WEBP, GIF) or video file (MP4, WEBM, MOV).');
      return;
    }

    setUploadProgress(10);
    const reader = new FileReader();

    reader.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const percent = Math.round((evt.loaded / evt.total) * 90);
        setUploadProgress(percent);
      }
    };

    reader.onload = () => {
      const base64Data = reader.result as string;
      const previewUrl = URL.createObjectURL(file);

      setAttachment({
        file,
        previewUrl,
        isVideo: isVid,
        base64Data
      });
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(null), 300);
    };

    reader.onerror = () => {
      setErrorMsg('Failed to read file. Please try selecting another file.');
      setUploadProgress(null);
    };

    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachment(null);
    setUploadProgress(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!whatHappened.trim()) {
      setErrorMsg('Please describe what happened.');
      return;
    }

    if (!whatWereYouTryingToDo.trim()) {
      setErrorMsg('Please describe what you were trying to do.');
      return;
    }

    setIsSubmitting(true);

    try {
      const diagnostics = {
        appVersion: '2.4.0',
        devicePlatform: `${navigator.platform} - ${navigator.userAgent}`,
        browserInfo: navigator.userAgent,
        currentRoute: window.location.pathname + window.location.hash,
        relevantFeature: activeFeature,
        accountId: isGuest ? null : account.id,
        userType: isGuest ? ('guest' as const) : ('logged-in' as const)
      };

      const payload = {
        whatHappened: whatHappened.trim(),
        whatWereYouTryingToDo: whatWereYouTryingToDo.trim(),
        additionalDetails: additionalDetails.trim(),
        diagnostics,
        reporterProfile: {
          username: account.username || account.name || 'Anonymous',
          email: account.email || undefined,
          role: account.role || (isGuest ? 'guest' : 'user'),
          avatar: account.avatar || null
        },
        attachment: attachment
          ? {
              fileName: attachment.file.name,
              fileType: attachment.file.type,
              fileSize: attachment.file.size,
              base64Data: attachment.base64Data
            }
          : null
      };

      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit bug report.');
      }

      setSubmittedReportId(data.reportId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error submitting report. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    handleRemoveAttachment();
    setWhatHappened('');
    setWhatWereYouTryingToDo('');
    setAdditionalDetails('');
    setErrorMsg(null);
    setSubmittedReportId(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="relative w-full max-w-lg my-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800/80 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Report a Bug / Feedback</h3>
              <p className="text-xs text-slate-400">Help us improve AniVault by sharing what went wrong</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {submittedReportId ? (
            /* Success State */
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-white">Thanks! Your bug report has been submitted.</h4>
                <p className="text-xs text-slate-400">
                  Our team and owner will review your report shortly.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 max-w-xs mx-auto">
                <span className="text-[11px] text-slate-400 block font-mono uppercase tracking-wider">Report ID</span>
                <span className="text-sm font-black text-rose-400 font-mono select-all">{submittedReportId}</span>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            /* Form State */
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-rose-950/80 border border-rose-500/60 rounded-xl flex items-start gap-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Field 1: What happened */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>What happened? <span className="text-rose-400">*</span></span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={whatHappened}
                  onChange={(e) => setWhatHappened(e.target.value)}
                  placeholder="Describe the issue or error you encountered..."
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all resize-none"
                />
              </div>

              {/* Field 2: What were you trying to do */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200">
                  What were you trying to do? <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  value={whatWereYouTryingToDo}
                  onChange={(e) => setWhatWereYouTryingToDo(e.target.value)}
                  placeholder="e.g. Trying to search for an anime or click episode link..."
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all resize-none"
                />
              </div>

              {/* Field 3: Additional details */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <span>Additional Details</span>
                  <span className="text-[10px] text-slate-500 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={additionalDetails}
                  onChange={(e) => setAdditionalDetails(e.target.value)}
                  placeholder="Any extra steps, specific anime title, or observations..."
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all resize-none"
                />
              </div>

              {/* Field 4: Attach Screenshot or Video */}
              <div className="space-y-2 pt-1 border-t border-slate-800/80">
                <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span>Attach Screenshot or Video</span>
                  <span className="text-[10px] text-slate-500 font-normal">Optional (Max 20MB)</span>
                </label>

                {!attachment ? (
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-800 hover:border-rose-500/60 rounded-xl bg-slate-950/60 hover:bg-slate-950 transition-all cursor-pointer group">
                    <div className="flex items-center gap-2 text-slate-400 group-hover:text-rose-400 transition-colors">
                      <Upload className="w-5 h-5" />
                      <span className="text-xs font-semibold">Choose image or video file</span>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1">PNG, JPG, WEBP, MP4, WEBM, MOV</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        {attachment.isVideo ? (
                          <Film className="w-4 h-4 text-rose-400 shrink-0" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span className="text-xs font-medium text-slate-200 truncate">{attachment.file.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          ({(attachment.file.size / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleRemoveAttachment}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors shrink-0"
                        title="Remove attachment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Preview box */}
                    <div className="relative rounded-lg overflow-hidden border border-slate-800 max-h-40 flex items-center justify-center bg-black">
                      {attachment.isVideo ? (
                        <video src={attachment.previewUrl} controls className="max-h-36 w-full object-contain" />
                      ) : (
                        <img src={attachment.previewUrl} alt="Preview" className="max-h-36 object-contain" />
                      )}
                    </div>
                  </div>
                )}

                {/* Progress bar */}
                {uploadProgress !== null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                      <span>Processing file...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-500 transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Diagnostic metadata badge info */}
              <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-400">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Basic device &amp; route diagnostics are automatically attached securely.</span>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="w-1/3 py-2.5 px-3 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !whatHappened.trim() || !whatWereYouTryingToDo.trim()}
                  className="w-2/3 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg shadow-rose-600/20"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <Bug className="w-4 h-4" />
                      <span>Submit Bug Report</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
