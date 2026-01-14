import React, { useRef, useEffect } from 'react';

interface VideoUploadProps {
    onFileSelected: (path: string) => void;
    onTimeUpdate?: (time: number) => void;
    currentPath?: string;
    seekTime?: number | null;
    playUntilTime?: number | null;
    videoRef?: React.RefObject<HTMLVideoElement>;
    onVideoPause?: () => void;
    disabled?: boolean;
    onUserSeek?: () => void;
}

const VideoUpload: React.FC<VideoUploadProps> = ({ onFileSelected, onTimeUpdate, currentPath, seekTime, playUntilTime, videoRef, onVideoPause, disabled, onUserSeek }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const internalVideoRef = useRef<HTMLVideoElement>(null);
    const activeRef = videoRef || internalVideoRef;
    const [videoSrc, setVideoSrc] = React.useState<string>('');
    const [isDragging, setIsDragging] = React.useState(false);
    const [statusText, setStatusText] = React.useState<string>('');
    const isProgrammaticSeek = useRef(false);

    useEffect(() => {
        if (seekTime !== undefined && seekTime !== null && activeRef.current) {
            isProgrammaticSeek.current = true;
            activeRef.current.currentTime = seekTime;
            activeRef.current.play().catch(e => console.error("Auto-play failed:", e));
        }
    }, [seekTime]);

    useEffect(() => {
        let active = true;

        const loadVideo = async () => {
            if (!currentPath) {
                if (active) setVideoSrc('');
                return;
            }

            try {
                const url = await (window as any).ipcRenderer.invoke('get-file-url', currentPath);
                if (active) {
                    setVideoSrc(url);
                }
            } catch (error) {
                console.error("Failed to load video:", error);
            }
        };

        loadVideo();
        return () => { active = false; };
    }, [currentPath]);

    const processFileProxy = async (file: File) => {
        if (disabled) return;
        const blobUrl = URL.createObjectURL(file);
        setVideoSrc(blobUrl);

        try {
            console.log("Caching file...");
            const cachedPath = await (window as any).ipcRenderer.invoke('cache-video', file.path);
            console.log("Cached path:", cachedPath);
            onFileSelected(cachedPath);

            console.log("Analyzing video codec...");
            const analysis = await (window as any).ipcRenderer.invoke('run-backend', [
                '--action', 'analyze_video',
                '--input', cachedPath
            ]);

            if (analysis && analysis.success && analysis.info) {
                const { video_codec } = analysis.info;
                console.log("Video Codec:", video_codec);

                const supportedCodecs = ['h264', 'vp8', 'vp9', 'av1'];
                const isSupported = supportedCodecs.some((c: string) => video_codec.toLowerCase().includes(c));

                if (!isSupported) {
                    console.log(`Codec ${video_codec} not natively supported. Transcoding...`);
                    setStatusText("转码中，请稍候...");

                    const transcodedPath = cachedPath.replace(/\.(\w+)$/, '_transcoded.mp4');

                    const transcodeResult = await (window as any).ipcRenderer.invoke('run-backend', [
                        '--action', 'transcode_video',
                        '--input', cachedPath,
                        '--output', transcodedPath
                    ]);

                    if (transcodeResult && transcodeResult.success) {
                        setStatusText("");
                        console.log("Transcoding complete. Reloading video...");
                        const newUrl = await (window as any).ipcRenderer.invoke('get-file-url', transcodedPath);
                        setVideoSrc(newUrl);
                        onFileSelected(transcodedPath);
                    } else {
                        setStatusText("转码失败");
                        console.error("Transcoding failed:", transcodeResult?.error);
                    }
                }
            }

        } catch (error) {
            console.error("Caching failed:", error);
            // @ts-ignore
            onFileSelected(file.path);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const file = event.target.files?.[0];
        if (file) processFileProxy(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (!disabled) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file && (file.type.startsWith('video/') || file.type.startsWith('audio/'))) {
            processFileProxy(file);
        }
    };

    const handleTimeUpdate = () => {
        if (activeRef.current) {
            const now = activeRef.current.currentTime;
            let reportTime = now;

            if (playUntilTime !== undefined && playUntilTime !== null) {
                if (now >= playUntilTime) {
                    activeRef.current.pause();
                    // Clamp reported time to playUntilTime to prevent UI jumping to next segment
                    reportTime = playUntilTime;

                    // Optional: Reset currentTime to playUntilTime to visually snap back?
                    // activeRef.current.currentTime = playUntilTime; 
                    // (Maybe distracting, just clamping report is enough for UI sync)
                }
            }

            if (onTimeUpdate) {
                onTimeUpdate(reportTime);
            }
        }
    };

    return (
        <div
            style={{
                padding: '20px',
                border: isDragging ? '2px dashed #6366f1' : '1px solid #444',
                borderRadius: '8px',
                backgroundColor: isDragging ? 'rgba(99, 102, 241, 0.1)' : '#1f2937',
                position: 'relative'
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <h3 style={{ marginTop: 0 }}>1. 选择视频</h3>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                <input
                    type="file"
                    accept="video/*,audio/*"
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    disabled={disabled}
                />
                <button
                    onClick={() => {
                        if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                            fileInputRef.current.click();
                        }
                    }}
                    disabled={disabled}
                    style={{
                        padding: '10px 20px',
                        backgroundColor: disabled ? '#4b5563' : '#6366f1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        width: '100%',
                        fontSize: '1em'
                    }}
                >
                    {isDragging ? '释放文件以加载' : '选择视频 (或拖入文件)'}
                </button>
            </div>

            {currentPath && videoSrc && (
                <div style={{ marginTop: '15px' }}>
                    <div style={{ background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                        <video
                            ref={activeRef}
                            key={videoSrc} // Force re-render on source change
                            src={videoSrc}
                            controls
                            style={{ width: '100%', maxHeight: '600px', display: 'block' }}
                            onTimeUpdate={handleTimeUpdate}
                            onPause={onVideoPause}
                            onEnded={onVideoPause}
                            onSeeking={() => {
                                if (isProgrammaticSeek.current) {
                                    isProgrammaticSeek.current = false;
                                } else if (onUserSeek) {
                                    onUserSeek();
                                }
                            }}
                            onError={(e) => {
                                console.error("Video playback error:", e);
                            }}
                        />
                    </div>
                    {/* Path display moved below video */}
                    {currentPath && (
                        <div style={{
                            marginTop: '10px',
                            fontSize: '0.85em',
                            color: '#6b7280',
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                            overflowWrap: 'anywhere'
                        }}>
                            文件路径: {currentPath}
                        </div>
                    )}
                </div>
            )}

            {statusText && (
                <div style={{ marginTop: '10px', color: '#6366f1' }}>
                    {statusText}
                </div>
            )}

            {currentPath && !videoSrc && !statusText && (
                <div style={{ marginTop: '15px', padding: '10px', color: 'var(--text-secondary)' }}>
                    正在加载视频...
                </div>
            )}
        </div>
    );
};

export default VideoUpload;
