import React, { useState, useEffect } from 'react';
import {
  Download,
  RefreshCw,
  FolderDown,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface OwnerSourceDownloadPanelProps {
  compact?: boolean;
  onAuditUpdated?: () => void;
}

function encodeOwnerPathToken(token: string): string {
  return token.replace(/\./g, '_dot_');
}

export const OwnerSourceDownloadPanel: React.FC<OwnerSourceDownloadPanelProps> = ({
  compact = false,
  onAuditUpdated
}) => {
  const [sourcePkgInfo, setSourcePkgInfo] = useState<any>(null);
  const [ownerToken, setOwnerToken] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('anivault_owner_session_token') || '' : ''
  );
  const [updatingSource, setUpdatingSource] = useState<boolean>(false);
  const [downloadingSource, setDownloadingSource] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'idle' | 'generating' | 'success' | 'error';
    title?: string;
    message: string;
    filename?: string;
    sha256?: string;
    totalFiles?: number;
    compressedMB?: string;
    generatedAt?: string;
  }>({ type: 'idle', message: '' });

  const ensureOwnerToken = async (): Promise<string> => {
    let token = localStorage.getItem('anivault_owner_session_token') || ownerToken || '';
    if (token) {
      const checkRes = await fetch('/api/owner/session', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-anivault-owner-session': token
        },
        credentials: 'include'
      }).catch(() => null);
      if (checkRes && checkRes.ok) {
        const checkData = await checkRes.json().catch(() => null);
        if (checkData?.authenticated) {
          if (checkData.sessionToken && checkData.sessionToken !== token) {
            token = checkData.sessionToken;
            localStorage.setItem('anivault_owner_session_token', token);
          }
          setOwnerToken(token);
          return token;
        }
      }
    }

    // Synchronize active Owner session via /api/owner/switch if authorized
    try {
      const switchRes = await fetch('/api/owner/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({})
      });
      if (switchRes.ok) {
        const switchData = await switchRes.json();
        if (switchData.sessionToken) {
          localStorage.setItem('anivault_owner_session_token', switchData.sessionToken);
          setOwnerToken(switchData.sessionToken);
          return switchData.sessionToken;
        }
      }
    } catch {
      // Fallback to current token
    }

    return token;
  };

  const fetchSourceMetadata = async () => {
    try {
      const token = await ensureOwnerToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-anivault-owner-session'] = token;
      }

      const infoRes = await fetch('/api/owner/source-package/info', {
        headers,
        credentials: 'include',
        cache: 'no-store'
      });
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        setSourcePkgInfo(infoData.metadata || null);
        if (infoData.sessionToken) {
          localStorage.setItem('anivault_owner_session_token', infoData.sessionToken);
          setOwnerToken(infoData.sessionToken);
        }
      }
    } catch (err) {
      console.error('Failed to fetch source package metadata:', err);
    }
  };

  useEffect(() => {
    fetchSourceMetadata();
  }, []);

  const buildStandardDownloadUrl = (token: string, filename: string): string => {
    const cleanFilename = filename.endsWith('.zip')
      ? filename
      : filename.replace(/\.(tar\.gz|tgz)$/i, '') + '.zip';
    if (token) {
      return `/api/owner/source-package/download/t/${encodeURIComponent(encodeOwnerPathToken(token))}/${encodeURIComponent(cleanFilename)}`;
    }
    return `/api/owner/source-package/download/${encodeURIComponent(cleanFilename)}`;
  };

  const triggerBrowserAttachmentDownload = (downloadUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Action 1: “Update Download File” — Generate/refresh the source archive and replace previous archive without auto-downloading
  const handleUpdateDownloadFile = async () => {
    setUpdatingSource(true);
    setStatusBanner({
      type: 'generating',
      title: 'Updating Download File...',
      message: 'Generating and refreshing the source archive using the latest current ANIVEX project files...'
    });

    try {
      const token = await ensureOwnerToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-anivault-owner-session'] = token;
      }

      const upRes = await fetch('/api/owner/source-package/update', {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store'
      });

      const upData = await upRes.json().catch(() => ({
        error: `Archive update failed with HTTP ${upRes.status}`
      }));

      if (!upRes.ok || !upData.success) {
        setStatusBanner({
          type: 'error',
          title: 'Archive Update Failed',
          message: upData.error || `Failed to rebuild latest source archive (HTTP ${upRes.status}).`
        });
        return;
      }

      if (upData.sessionToken) {
        localStorage.setItem('anivault_owner_session_token', upData.sessionToken);
        setOwnerToken(upData.sessionToken);
      }

      if (upData.metadata) {
        setSourcePkgInfo(upData.metadata);
      } else {
        fetchSourceMetadata();
      }
      if (onAuditUpdated) onAuditUpdated();

      const pkg = upData.package || {};
      const compressedMB = ((pkg.compressedBytes || 0) / (1024 * 1024)).toFixed(2);

      setStatusBanner({
        type: 'success',
        title: 'Download File Updated',
        message: `Latest ANIVEX source archive (${pkg.totalFiles} files, ${compressedMB} MB) has been generated and replaced the previous version. Tap "Download Latest App Source" to download it.`,
        filename: pkg.filename,
        sha256: pkg.sha256,
        totalFiles: pkg.totalFiles,
        compressedMB,
        generatedAt: pkg.generatedAt
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        title: 'Archive Update Error',
        message: err?.message || 'Unexpected network error while updating source archive.'
      });
    } finally {
      setUpdatingSource(false);
    }
  };

  // Action 2: “Download Latest App Source” — Standard browser file download (triggers native iOS/Safari bottom download sheet)
  const handleDownloadLatestAppSource = async () => {
    setDownloadingSource(true);

    try {
      const activeToken = ownerToken || localStorage.getItem('anivault_owner_session_token') || '';
      const rawFilename =
        sourcePkgInfo?.packageName ||
        `anivex-latest-source-${new Date().toISOString().slice(0, 10)}.zip`;
      const filename = rawFilename.endsWith('.zip')
        ? rawFilename
        : rawFilename.replace(/\.(tar\.gz|tgz)$/i, '') + '.zip';

      // If we already have the verified Owner session token and archive metadata, trigger the standard
      // HTTP attachment download synchronously inside the user tap gesture so iPhone/Safari shows the
      // native bottom download sheet ("Download" / "Save to Drive") without redirecting or opening Files.
      if (activeToken && sourcePkgInfo?.available) {
        const downloadUrl = buildStandardDownloadUrl(activeToken, filename);
        triggerBrowserAttachmentDownload(downloadUrl, filename);

        const compressedMB = sourcePkgInfo?.lastCompressedBytes
          ? (sourcePkgInfo.lastCompressedBytes / (1024 * 1024)).toFixed(2)
          : ((sourcePkgInfo?.totalUncompressedBytes || 0) / (1024 * 1024)).toFixed(2);

        setStatusBanner({
          type: 'success',
          title: 'Browser Download Started',
          message: `Downloading "${filename}" (${sourcePkgInfo.totalFiles} files). Choose "Download" or "Save to Drive" in your browser's download sheet.`,
          filename,
          sha256: sourcePkgInfo.lastSha256,
          totalFiles: sourcePkgInfo.totalFiles,
          compressedMB,
          generatedAt: sourcePkgInfo.lastUpdatedAt || sourcePkgInfo.generatedAt
        });

        setTimeout(() => {
          fetchSourceMetadata();
          if (onAuditUpdated) onAuditUpdated();
        }, 800);
        return;
      }

      // Fallback if token or archive was not yet initialized: verify on server first, then trigger download
      setStatusBanner({
        type: 'generating',
        title: 'Verifying Source Archive...',
        message: 'Verifying the latest ANIVEX source archive exists and is readable before starting browser download...'
      });

      const token = await ensureOwnerToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-anivault-owner-session'] = token;
      }

      const infoRes = await fetch('/api/owner/source-package/info', {
        headers,
        credentials: 'include',
        cache: 'no-store'
      });

      const infoData = await infoRes.json().catch(() => ({
        error: `Verification failed (HTTP ${infoRes.status}).`
      }));

      if (!infoRes.ok || !infoData?.metadata?.available) {
        setStatusBanner({
          type: 'error',
          title: 'Download Failed',
          message: infoData?.error || 'Latest source archive could not be verified on the server.'
        });
        return;
      }

      const verifiedToken = infoData.sessionToken || token;
      if (verifiedToken) {
        localStorage.setItem('anivault_owner_session_token', verifiedToken);
        setOwnerToken(verifiedToken);
      }
      setSourcePkgInfo(infoData.metadata);

      const verifiedFilename =
        infoData.metadata.packageName ||
        `anivex-latest-source-${new Date().toISOString().slice(0, 10)}.zip`;
      const downloadUrl = buildStandardDownloadUrl(verifiedToken, verifiedFilename);
      triggerBrowserAttachmentDownload(downloadUrl, verifiedFilename);

      const compressedMB = infoData.metadata.lastCompressedBytes
        ? (infoData.metadata.lastCompressedBytes / (1024 * 1024)).toFixed(2)
        : ((infoData.metadata.totalUncompressedBytes || 0) / (1024 * 1024)).toFixed(2);

      setStatusBanner({
        type: 'success',
        title: 'Browser Download Started',
        message: `Downloading "${verifiedFilename}" (${infoData.metadata.totalFiles} files, ${compressedMB} MB). Choose "Download" or "Save to Drive" in your browser's download sheet.`,
        filename: verifiedFilename,
        sha256: infoData.metadata.lastSha256,
        totalFiles: infoData.metadata.totalFiles,
        compressedMB,
        generatedAt: infoData.metadata.lastUpdatedAt || infoData.metadata.generatedAt
      });

      if (onAuditUpdated) onAuditUpdated();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        title: 'Source Archive Download Error',
        message: err?.message || 'Failed to download the latest application source archive.'
      });
    } finally {
      setDownloadingSource(false);
    }
  };

  return (
    <div
      id="owner-download-latest-source-card"
      className="bg-slate-900/95 border-2 border-emerald-500/40 rounded-2xl p-4 sm:p-5 space-y-4 shadow-lg shadow-emerald-950/20"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderDown className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-black uppercase tracking-wider text-white">
              Download Latest App Source
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-extrabold bg-amber-500/15 text-amber-300 border border-amber-500/40">
              OWNER ONLY
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ZIP SOURCE ARCHIVE
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Generates and downloads the latest ANIVEX project source archive (<code className="text-emerald-300 font-mono">.zip</code>). Passwords, API keys, SMTP credentials, session secrets, tokens, and sensitive <code className="text-rose-300 font-mono">.env</code> values are automatically excluded.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            id="btn-update-latest-app-source"
            onClick={handleUpdateDownloadFile}
            disabled={updatingSource || downloadingSource}
            className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {updatingSource ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Updating File...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Update Download File</span>
              </>
            )}
          </button>

          <button
            type="button"
            id="btn-download-latest-app-source"
            onClick={handleDownloadLatestAppSource}
            disabled={downloadingSource || updatingSource}
            className="px-4 py-2.5 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {downloadingSource ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Starting Download...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Download Latest App Source</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!compact && sourcePkgInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400">Live Project Files:</span>
            <span className="font-mono font-bold text-emerald-400">{sourcePkgInfo.totalFiles} files</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400">Archive Size:</span>
            <span className="font-mono font-bold text-slate-200">
              {sourcePkgInfo.lastCompressedBytes
                ? `${(sourcePkgInfo.lastCompressedBytes / (1024 * 1024)).toFixed(2)} MB (.zip)`
                : `${((sourcePkgInfo.totalUncompressedBytes || 0) / (1024 * 1024)).toFixed(2)} MB (raw -> .zip)`}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400">Secret Sanitization:</span>
            <span className="font-mono font-bold text-amber-400">Enforced (No Secrets)</span>
          </div>
        </div>
      )}

      {statusBanner.type !== 'idle' && (
        <div
          id="source-download-status-banner"
          className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${
            statusBanner.type === 'generating'
              ? 'bg-amber-950/50 border-amber-500/40 text-amber-200'
              : statusBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
          }`}
        >
          {statusBanner.type === 'generating' && (
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0 mt-0.5" />
          )}
          {statusBanner.type === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          )}
          {statusBanner.type === 'error' && (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 min-w-0 flex-1">
            <p className="font-bold">
              {statusBanner.title ||
                (statusBanner.type === 'generating'
                  ? 'Updating Source Archive...'
                  : statusBanner.type === 'success'
                  ? 'Source Archive Ready'
                  : 'Source Archive Error')}
            </p>
            <p className="text-[11px] opacity-90 leading-relaxed">{statusBanner.message}</p>
            {statusBanner.type === 'success' && statusBanner.filename && (
              <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-emerald-300/90">
                <span>File: {statusBanner.filename}</span>
                {statusBanner.generatedAt && (
                  <span>Generated: {new Date(statusBanner.generatedAt).toLocaleTimeString()}</span>
                )}
                {statusBanner.sha256 && (
                  <span>SHA-256: {statusBanner.sha256.slice(0, 16)}...</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
