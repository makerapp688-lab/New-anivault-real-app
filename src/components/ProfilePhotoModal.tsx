import React, { useState, useRef } from 'react';
import {
  X,
  Camera,
  Image as ImageIcon,
  FolderOpen,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Shield,
  Loader2
} from 'lucide-react';
import { setAccountAvatar } from '../utils/userStorage.ts';

interface ProfilePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  username: string;
  isOwner?: boolean;
  currentAvatar?: string | null;
  onAvatarUpdated?: (newAvatarUrl: string | null) => void;
}

export const ProfilePhotoModal: React.FC<ProfilePhotoModalProps> = ({
  isOpen,
  onClose,
  accountId,
  username,
  isOwner = false,
  currentAvatar,
  onAvatarUpdated
}) => {
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Security validation and canvas square-crop processing
  const processImageFile = (file: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    // 1. File type validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setErrorMsg('Invalid file format. Please select a valid JPEG, PNG, WebP, or GIF image.');
      return;
    }

    // 2. File size validation (max 5 MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setErrorMsg('Image size exceeds 5MB limit. Please choose a smaller photo.');
      return;
    }

    setProcessing(true);

    const reader = new FileReader();
    reader.onerror = () => {
      setProcessing(false);
      setErrorMsg('Failed to read selected image file.');
    };

    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result !== 'string') {
        setProcessing(false);
        setErrorMsg('Could not process image data.');
        return;
      }

      const img = new Image();
      img.onerror = () => {
        setProcessing(false);
        setErrorMsg('The selected file could not be parsed as a valid image.');
      };

      img.onload = () => {
        try {
          // Calculate center-cropped square dimensions
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          // Target dimension: 320x320 for crisp avatar rendering at minimal storage
          const targetDim = 320;
          const canvas = document.createElement('canvas');
          canvas.width = targetDim;
          canvas.height = targetDim;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas context unavailable');
          }

          // Draw square crop
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetDim, targetDim);

          // Compress to WebP or JPEG
          const processedUrl = canvas.toDataURL('image/jpeg', 0.88);

          // Persist isolated to this specific account
          setAccountAvatar(accountId, processedUrl);

          setProcessing(false);
          setSuccessMsg('Profile photo updated successfully!');

          if (onAvatarUpdated) {
            onAvatarUpdated(processedUrl);
          }

          setTimeout(() => {
            onClose();
          }, 600);
        } catch (err: any) {
          setProcessing(false);
          setErrorMsg(err.message || 'Error optimizing profile photo.');
        }
      };

      img.src = result;
    };

    reader.readAsDataURL(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
    // Reset value so selecting the same file again triggers change
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setErrorMsg(null);
    setAccountAvatar(accountId, null);
    if (onAvatarUpdated) {
      onAvatarUpdated(null);
    }
    setSuccessMsg('Profile photo removed.');
    setTimeout(() => {
      onClose();
    }, 500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-photo-modal-title"
    >
      <div
        className={`w-full max-w-sm rounded-3xl p-5 sm:p-6 space-y-5 shadow-2xl border transition-all ${
          isOwner
            ? 'bg-black border-amber-500/60 shadow-amber-500/10 text-white'
            : 'bg-slate-950 dark:bg-slate-950 light:bg-white border-slate-800 dark:border-slate-800 light:border-slate-200 text-white dark:text-white light:text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
        id="profile-photo-modal"
      >
        {/* Hidden inputs using platform native pickers */}
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleInputChange}
          aria-label="Upload photo from library"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handleInputChange}
          aria-label="Take a new photo with camera"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange}
          aria-label="Choose image file"
        />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isOwner
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-400/40'
                  : 'bg-rose-600/20 text-rose-500 border border-rose-500/30'
              }`}
            >
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="profile-photo-modal-title"
                className="text-base font-black tracking-tight"
              >
                Change Profile Photo
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500">
                {username}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Avatar Preview */}
        <div className="flex flex-col items-center justify-center py-2">
          <div className="relative">
            {currentAvatar ? (
              <div className="w-24 h-24 rounded-full overflow-hidden shadow-xl border border-slate-700 bg-transparent flex items-center justify-center">
                <img
                  src={currentAvatar}
                  alt={username}
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
            ) : (
              <div
                className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black shadow-xl ${
                  isOwner
                    ? 'bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 border-2 border-amber-400 ring-2 ring-amber-500/30'
                    : 'bg-gradient-to-tr from-rose-600 to-pink-500 text-white border border-rose-400/40'
                }`}
              >
                {isOwner ? (
                  <Shield className="w-12 h-12 text-slate-950" />
                ) : (
                  (username || 'A').charAt(0).toUpperCase()
                )}
              </div>
            )}

            {processing && (
              <div className="absolute inset-0 rounded-full bg-black/70 flex flex-col items-center justify-center gap-1.5">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
                <span className="text-[10px] font-bold text-white">Saving...</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 mt-2">
            Max 5MB (JPEG, PNG, WebP)
          </p>
        </div>

        {/* Status Messages */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Action Menu List */}
        <div className="space-y-2">
          {/* 1. Photo Library */}
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            disabled={processing}
            className={`w-full p-3 rounded-xl flex items-center gap-3 text-xs font-bold transition-all cursor-pointer border ${
              isOwner
                ? 'bg-slate-900/90 hover:bg-slate-800 border-amber-500/40 hover:border-amber-400 text-amber-200'
                : 'bg-slate-900/80 dark:bg-slate-900/80 light:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800'
            }`}
          >
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div className="text-left flex-1">
              <span className="block font-bold">Photo Library</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-normal">
                Choose an existing picture from your device
              </span>
            </div>
          </button>

          {/* 2. Take Photo (Device Camera) */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={processing}
            className={`w-full p-3 rounded-xl flex items-center gap-3 text-xs font-bold transition-all cursor-pointer border ${
              isOwner
                ? 'bg-slate-900/90 hover:bg-slate-800 border-amber-500/40 hover:border-amber-400 text-amber-200'
                : 'bg-slate-900/80 dark:bg-slate-900/80 light:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800'
            }`}
          >
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Camera className="w-4 h-4" />
            </div>
            <div className="text-left flex-1">
              <span className="block font-bold">Take Photo</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-normal">
                Use your device camera to capture a new photo
              </span>
            </div>
          </button>

          {/* 3. Choose File / Other */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
            className={`w-full p-3 rounded-xl flex items-center gap-3 text-xs font-bold transition-all cursor-pointer border ${
              isOwner
                ? 'bg-slate-900/90 hover:bg-slate-800 border-amber-500/40 hover:border-amber-400 text-amber-200'
                : 'bg-slate-900/80 dark:bg-slate-900/80 light:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200 border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800'
            }`}
          >
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div className="text-left flex-1">
              <span className="block font-bold">Choose File</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-normal">
                Browse file system or cloud files
              </span>
            </div>
          </button>

          {/* 4. Remove Photo Option (if photo is set) */}
          {currentAvatar && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={processing}
              className="w-full p-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-950/60 border border-rose-800/40 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Photo</span>
            </button>
          )}

          {/* 5. Cancel */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-100 hover:bg-slate-800 transition-colors cursor-pointer border border-transparent hover:border-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
