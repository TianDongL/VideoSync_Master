import { useState, useEffect, useRef } from 'react'
import './App.css'
import './components/ThemeButtonElement'
import VideoUpload from './components/VideoUpload'
import Timeline, { Segment } from './components/Timeline'
import TranslationPanel from './components/TranslationPanel'
import CloudBackground from './components/CloudBackground'

function App() {
  const [videoPath, setVideoPath] = useState<string>('')
  const [originalVideoPath, setOriginalVideoPath] = useState<string>('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(false)
  const [dubbingLoading, setDubbingLoading] = useState(false)
  const [generatingSegmentId, setGeneratingSegmentId] = useState<number | null>(null);
  const [retranslatingSegmentId, setRetranslatingSegmentId] = useState<number | null>(null);
  const [playingAudioIndex, setPlayingAudioIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVideoIndex, setPlayingVideoIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const timeIndex = segments.findIndex(seg => currentTime >= seg.start && currentTime < seg.end);
  const activeIndex = editingIndex !== null ? editingIndex : timeIndex;
  const [seekTime, setSeekTime] = useState<number | null>(null)
  const [playUntilTime, setPlayUntilTime] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [isIndeterminate, setIsIndeterminate] = useState(false);
  const [translatedSegments, setTranslatedSegments] = useState<Segment[]>([])
  const [targetLang, setTargetLang] = useState('English')
  const [mergedVideoPath, setMergedVideoPath] = useState<string>('')
  const timelineRef = useRef<HTMLDivElement>(null);
  const translationRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef<null | 'timeline' | 'translation'>(null);
  const [leftWidth, setLeftWidth] = useState(400);
  const [timelineWidth, setTimelineWidth] = useState(500);
  const [dragTarget, setDragTarget] = useState<'left' | 'middle' | null>(null);

  // Background Mode
  const [bgMode, setBgMode] = useState<'gradient' | 'dark'>(() => (localStorage.getItem('bgMode') as 'gradient' | 'dark') || 'gradient');
  const themeBtnRef = useRef<HTMLElement>(null);

  /* 
   * Transition Logic:
   * We use a fixed overlay for the gradient. 
   * We must Clear any legacy classNames (gradient-bg/dark-bg) from body so the solid background color works.
   */
  useEffect(() => {
    document.body.className = ''; // Remove 'gradient-bg' if present
    document.body.style.backgroundColor = 'var(--bg-primary, #0f172a)'; // Ensure dark base
    localStorage.setItem('bgMode', bgMode);
  }, [bgMode]);

  useEffect(() => {
    const btn = themeBtnRef.current;
    if (!btn) return;
    const handler = (e: any) => {
      setBgMode(e.detail === 'dark' ? 'dark' : 'gradient');
    };
    btn.addEventListener('change', handler);
    return () => btn.removeEventListener('change', handler);
  }, []);

  // Abort controller for One-Click Run
  const abortRef = useRef(false);

  // Listener for Backend Progress & Partial Results
  useEffect(() => {
    const handleProgress = (_event: any, value: number) => {
      setIsIndeterminate(false);
      setProgress(value);
    };

    const handlePartialResult = (_event: any, data: any) => {
      if (data && typeof data.index === 'number') {
        setTranslatedSegments(prev => {
          const newSegs = [...prev];
          if (newSegs[data.index]) {
            // Handle Audio Update
            if (data.audio_path !== undefined) {
              const isSuccess = data.success === true;
              newSegs[data.index] = {
                ...newSegs[data.index],
                audioPath: data.audio_path,
                audioStatus: isSuccess ? 'ready' : 'error'
              }
            }
            // Handle Text Update (Real-time translation)
            if (data.text !== undefined) {
              newSegs[data.index] = {
                ...newSegs[data.index],
                text: data.text
              }
            }
          }
          return newSegs;
        })
      }
    };

    (window as any).ipcRenderer.on('backend-progress', handleProgress);
    (window as any).ipcRenderer.on('backend-partial-result', handlePartialResult);

    return () => {
      const ipc = (window as any).ipcRenderer;
      if (ipc.off) {
        ipc.off('backend-progress', handleProgress);
        ipc.off('backend-partial-result', handlePartialResult);
      }
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragTarget === 'left') {
        const paddingOffset = 20;
        const overheads = 680; // 300(mid) + 300(right) + ~80(pads/resizers)
        const maxLeft = window.innerWidth - overheads;
        const newWidth = Math.max(250, Math.min(maxLeft, e.clientX - paddingOffset));
        setLeftWidth(newWidth);
      } else if (dragTarget === 'middle') {
        // Middle column starts after: 20(pad) + leftWidth + 10(resizer) = leftWidth + 30
        const startOffset = leftWidth + 30;
        const overheads = 380; // 300(right) + ~80(pads/resizers)
        const maxTimeline = window.innerWidth - leftWidth - overheads;
        const newWidth = Math.max(300, Math.min(maxTimeline, e.clientX - startOffset));
        setTimelineWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setDragTarget(null);
    };

    if (dragTarget) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [dragTarget, leftWidth]);

  // Sync Scroll Handler
  const handleScroll = (source: 'timeline' | 'translation') => {
    const sourceEl = source === 'timeline' ? timelineRef.current : translationRef.current;
    const targetEl = source === 'timeline' ? translationRef.current : timelineRef.current;

    if (!sourceEl || !targetEl) return;
    if (isScrollingRef.current && isScrollingRef.current !== source) return;

    isScrollingRef.current = source;

    // Calculate percentage or exact position? exact is better if height matches.
    // But content height might differ due to text length. Percentage is safer for now.
    // Or just map index to index? No, simple scroll sync for now.
    const percentage = sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight);
    targetEl.scrollTop = percentage * (targetEl.scrollHeight - targetEl.clientHeight);

    // Debounce reset
    clearTimeout((window as any).scrollTimeout);
    (window as any).scrollTimeout = setTimeout(() => {
      isScrollingRef.current = null;
    }, 50);
  };

  const formatTimeSRT = (seconds: number) => {
    const pad = (num: number, size: number) => ('000' + num).slice(size * -1);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
  };

  const handleASR = async (): Promise<Segment[] | null> => {
    if (!originalVideoPath) {
      setStatus('请先上传/选择视频');
      return null;
    }

    setLoading(true);
    setIsIndeterminate(true);
    setProgress(0);
    setStatus('正在识别字幕...');

    try {
      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'test_asr',
        '--input', originalVideoPath
      ]);

      if (abortRef.current) return null;

      console.log("ASR Result:", result);
      if (Array.isArray(result)) {
        // Enforce chronological sort
        result.sort((a: any, b: any) => a.start - b.start);

        // Update state
        setSegments(result);

        const paths = await (window as any).ipcRenderer.invoke('get-paths');
        const outputRoot = paths.outputDir;
        const filenameWithExt = videoPath.split(/[\\/]/).pop() || "video.mp4";
        const filenameNoExt = filenameWithExt.replace(/\.[^/.]+$/, "");
        const sessionOutputDir = `${outputRoot}\\${filenameNoExt}`;

        await (window as any).ipcRenderer.invoke('ensure-dir', sessionOutputDir);

        const srtContent = result.map((seg: any, index: number) => {
          return `${index + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`;
        }).join('\n');

        const srtPath = `${sessionOutputDir}\\${filenameNoExt}.srt`;
        await (window as any).ipcRenderer.invoke('save-file', srtPath, srtContent);

        setStatus(`识别完成，SRT已保存至 ${srtPath}。请在下方编辑字幕。`);
        return result;
      } else {
        setStatus('识别失败：输出格式无效。');
        return null;
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`错误: ${e.message}`);
      return null;
    } finally {
      if (!abortRef.current) {
        // Only turn off loading if not aborted (or if aborted, we want to stop anyway)
        // Actually always turn off loading for this step.
        setLoading(false);
        setIsIndeterminate(false);
        setProgress(0);
      }
    }
  };

  const handleTranslate = async (overrideSegments?: Segment[]): Promise<Segment[] | null> => {
    const segsToUse = overrideSegments || segments;
    if (segsToUse.length === 0) return null;

    setLoading(true);
    setIsIndeterminate(true);
    setProgress(0);
    setStatus(`正在翻译 ${segsToUse.length} 个片段到 ${targetLang}...`);

    // Initialize translatedSegments with placeholders
    const placeholders = segsToUse.map(seg => ({
      ...seg,
      text: '...',
      audioPath: undefined,
      audioStatus: undefined
    }));
    setTranslatedSegments(placeholders);

    try {
      if (abortRef.current) return null;

      // Prepare JSON for backend
      const inputJson = JSON.stringify(segsToUse);

      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'translate_text',
        '--input', inputJson,
        '--lang', targetLang,
        '--json'
      ]);

      if (abortRef.current) return null;

      if (result && result.success) {
        setTranslatedSegments(result.segments);
        setStatus("翻译完成！");
        return result.segments;
      } else {
        console.error("Translation failed:", result);
        setStatus(`翻译失败: ${result?.error || 'Unknown'}`);
        return null;
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`Translation Error: ${e.message}`);
      return null;
    } finally {
      if (!abortRef.current) {
        setLoading(false);
        setIsIndeterminate(false);
        setProgress(0);
      }
    }
  };

  const handleGenerateSingleDubbing = async (index: number) => {
    if (!originalVideoPath || !translatedSegments[index]) return;
    setGeneratingSegmentId(index);
    setStatus(`正在生成第 ${index + 1} 句配音...`);

    try {
      const seg = translatedSegments[index];
      const paths = await (window as any).ipcRenderer.invoke('get-paths');
      const filename = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
      const filenameNoExt = filename.replace(/\.[^/.]+$/, "");
      const segmentsDir = `${paths.outputDir}\\${filenameNoExt}\\${filenameNoExt}_segments`;

      await (window as any).ipcRenderer.invoke('ensure-dir', segmentsDir);

      const audioPath = `${segmentsDir}\\segment_${index}.wav`;

      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'generate_single_tts',
        '--input', originalVideoPath,
        '--output', audioPath,
        '--text', seg.text,
        '--start', seg.start.toString(),
        '--lang', targetLang,
        '--json'
      ]);

      if (result && result.success) {
        setTranslatedSegments(prev => {
          const newSegs = [...prev];
          newSegs[index] = { ...newSegs[index], audioPath: result.audio_path, audioStatus: 'ready' };
          return newSegs;
        });
        setStatus(`第 ${index + 1} 句配音生成完成`);
      } else {
        console.error("Single TTS failed:", result);
        setTranslatedSegments(prev => {
          const newSegs = [...prev];
          newSegs[index] = { ...newSegs[index], audioStatus: 'error' };
          return newSegs;
        });
        setStatus(`第 ${index + 1} 句配音失败: ${result?.error || 'Unknown'}`);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`配音生成错误: ${e.message}`);
    } finally {
      setGeneratingSegmentId(null);
    }
  };

  const handleGenerateAllDubbing = async (overrideSegments?: Segment[]): Promise<Segment[] | null> => {
    const segsToUse = overrideSegments || translatedSegments;
    if (!originalVideoPath || segsToUse.length === 0) return null;

    setDubbingLoading(true);
    setIsIndeterminate(true); // Show animation while preparing/extracting refs
    setProgress(0);
    setStatus("正在批量生成配音 (模型加载中可能较慢)...");

    try {
      if (abortRef.current) return null;

      const paths = await (window as any).ipcRenderer.invoke('get-paths');
      const filename = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
      const filenameNoExt = filename.replace(/\.[^/.]+$/, "");
      const segmentsDir = `${paths.outputDir}\\${filenameNoExt}\\${filenameNoExt}_segments`;

      await (window as any).ipcRenderer.invoke('ensure-dir', segmentsDir);

      const tempJsonPath = `${segmentsDir}\\batch_tasks.json`;

      // Prepare segments with pre-defined output paths to help backend
      const segmentsToProcess = segsToUse.map((seg, idx) => ({
        ...seg,
        // Ensure audioPath is set desired location if not already
        audioPath: seg.audioPath || `${segmentsDir}\\segment_${idx}.wav`
      }));

      await (window as any).ipcRenderer.invoke('save-file', tempJsonPath, JSON.stringify(segmentsToProcess));

      if (abortRef.current) return null;

      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'generate_batch_tts',
        '--input', originalVideoPath,
        '--ref', tempJsonPath,
        '--json'
      ]);

      if (abortRef.current) return null;

      if (result && result.success && Array.isArray(result.results)) {
        // Construct new segments based on results
        const newSegments = [...segmentsToProcess];

        result.results.forEach((res: any) => {
          if (newSegments[res.index]) {
            if (res.success) {
              newSegments[res.index] = {
                ...newSegments[res.index],
                audioPath: res.audio_path,
                audioStatus: 'ready'
              };
            } else {
              newSegments[res.index] = {
                ...newSegments[res.index],
                audioStatus: 'error'
              };
              console.error(`Segment ${res.index} failed:`, res.error);
            }
          }
        });

        setTranslatedSegments(newSegments);
        setStatus("批量配音生成完成");
        return newSegments;
      } else {
        setStatus(`批量配音失败: ${result?.error || 'Unknown'}`);
        return null;
      }

    } catch (e: any) {
      console.error(e);
      setStatus(`Batch Error: ${e.message}`);
      return null;
    } finally {
      if (!abortRef.current) {
        setDubbingLoading(false);
        setProgress(0);
      }
    }
  };

  const handlePlaySegmentAudio = (index: number, audioPath: string) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    // If clicking the same segment that is currently playing, toggle pause
    if (playingAudioIndex === index) {
      audioEl.pause();
      setPlayingAudioIndex(null);
      return;
    }

    // Play new segment
    const url = `file:///${audioPath.replace(/\\/g, '/')}`;
    audioEl.src = url;
    audioEl.play().catch(e => {
      console.error("Audio play failed", e);
      setPlayingAudioIndex(null);
      setStatus("播放失败: " + (e.message || "未知错误"));
    });

    setPlayingAudioIndex(index);
  };


  const handleDubbing = async (overrideSegments?: Segment[]): Promise<boolean> => {
    if (!originalVideoPath) {
      setStatus("请先上传/选择视频");
      return false;
    }

    const segsToUse = overrideSegments || translatedSegments;

    // Check if we have audio segments
    const hasAudio = segsToUse.some(s => s.audioPath);
    if (!hasAudio) {
      setStatus("请先生成配音音频");
      return false;
    }

    setDubbingLoading(true);
    setIsIndeterminate(true);
    setProgress(100); // Indeterminate bar
    setStatus("正在合并视频...");

    try {
      if (abortRef.current) return false;

      const paths = await (window as any).ipcRenderer.invoke('get-paths');
      const filename = originalVideoPath.split(/[\\/]/).pop() || "video.mp4";
      const filenameNoExt = filename.replace(/\.[^/.]+$/, "");
      const outputPath = `${paths.outputDir}\\${filenameNoExt}\\${filenameNoExt}_dubbed_${targetLang}.mp4`;
      const segmentsDir = `${paths.outputDir}\\${filenameNoExt}`;
      const jsonPath = `${segmentsDir}\\audio_segments.json`;

      // Filter and map segments for backend
      const audioSegments = segsToUse
        .filter(s => s.audioPath)
        .map(s => ({
          start: s.start,
          path: s.audioPath
        }));

      // Save JSON manifest
      await (window as any).ipcRenderer.invoke('save-file', jsonPath, JSON.stringify(audioSegments, null, 2));

      if (abortRef.current) return false;

      // Call merge_video
      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'merge_video',
        '--input', originalVideoPath,
        '--ref', jsonPath,
        '--output', outputPath
      ]);

      if (abortRef.current) return false;

      if (result && result.success) {
        setStatus("配音合并完成！");
        // setVideoPath(result.output); // Keep original video in the source player
        setMergedVideoPath(result.output);
        return true;
      } else {
        setStatus(`合并失败: ${result?.error || '未知错误'}`);
        return false;
      }

    } catch (error: any) {
      setStatus(`合并请求失败: ${error.message}`);
      return false;
    } finally {
      if (!abortRef.current) {
        setDubbingLoading(false);
        setIsIndeterminate(false);
        setProgress(0);
      }
    }
  };



  const handleReTranslate = async (index: number) => {
    if (loading || !translatedSegments[index]) return;

    setLoading(true);
    setRetranslatingSegmentId(index); // Set active index
    setStatus(`正在重新翻译片段 ${index + 1}...`);

    try {
      const sourceText = segments[index].text;
      const result = await (window as any).ipcRenderer.invoke('run-backend', [
        '--action', 'translate_text',
        '--input', sourceText,
        '--lang', targetLang,
        '--json'
      ]);

      if (result && result.success) {
        // Handle both simple text return and segment list return
        const newText = result.text || (result.segments && result.segments[0]?.text);

        if (newText) {
          setTranslatedSegments(prev => {
            const newSegs = [...prev];
            newSegs[index] = { ...newSegs[index], text: newText };
            return newSegs;
          });
          setStatus("重新翻译完成");
        } else {
          setStatus("重新翻译失败：返回结果为空");
        }
      } else {
        console.error("Re-translation failed:", result);
        setStatus(`重新翻译失败: ${result?.error || 'Unknown'}`);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(`重新翻译错误: ${e.message}`);
    } finally {
      setProgress(0);
      setLoading(false);
      setRetranslatingSegmentId(null); // Clear active index
      setIsIndeterminate(false);
    }
  };

  const handleStop = async () => {
    abortRef.current = true;
    try {
      await (window as any).ipcRenderer.invoke('kill-backend');
      setStatus("任务已由用户停止");
    } catch (e) {
      console.error("Stop failed", e);
    } finally {
      setLoading(false);
      setDubbingLoading(false);
      setGeneratingSegmentId(null);
      setIsIndeterminate(false);
      setProgress(0);
    }
  };

  const handleOneClickRun = async () => {
    if (!originalVideoPath) {
      setStatus("请先选择视频");
      return;
    }
    abortRef.current = false;

    // Steps are sequential. Logic checks result of previous step.
    const asrSegs = await handleASR();
    if (!asrSegs) return;

    const transSegs = await handleTranslate(asrSegs);
    if (!transSegs) return;

    const dubbedSegs = await handleGenerateAllDubbing(transSegs);
    if (!dubbedSegs) return;

    await handleDubbing(dubbedSegs);
  };

  const handleTranslateAndDub = async () => {
    // Logic similar to OneClickRun but skipping ASR
    abortRef.current = false;
    const transSegs = await handleTranslate(); // Use current segments state
    if (!transSegs) return;

    // 继续生成配音
    await handleGenerateAllDubbing(transSegs);
  };

  // Modified to support pause toggle
  const handlePlaySegment = (startTime: number, endTime?: number, index?: number) => {
    // If we have an index and it matches currently playing video segment, toggle pause
    if (index !== undefined && playingVideoIndex === index) {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      setPlayingVideoIndex(null);
      return;
    }

    // Switch to new segment
    if (index !== undefined) {
      setPlayingVideoIndex(index);
    } else {
      setPlayingVideoIndex(null); // Unknown index
    }

    setSeekTime(null);
    setTimeout(() => {
      setSeekTime(startTime);
      if (endTime) {
        // Subtle offset to prevent jumping to next segment at end
        setPlayUntilTime(endTime - 0.05);
      } else {
        setPlayUntilTime(null);
      }
    }, 10);
  };


  return (
    <div className="container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '20px', boxSizing: 'border-box', color: 'white' }}>
      <theme-button
        key="theme-btn-3"
        ref={themeBtnRef}
        value={bgMode === 'dark' ? 'dark' : 'light'}
        size="1"
        style={{
          position: 'fixed',
          top: '20px',
          right: '30px',
          width: '180px',
          height: '70px',
          zIndex: 1000,
          cursor: 'pointer'
        }}
      ></theme-button>

      {/* Smooth Background Transition Layer (z-index 0) */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        opacity: bgMode === 'gradient' ? 1 : 0,
        transition: 'opacity 0.5s ease-in-out',
        pointerEvents: 'none'
      }} />

      <CloudBackground mode={bgMode} />

      <style>{`
        @keyframes indeterminate-progress {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
      `}</style>

      {/* Main Content Wrapper (z-index 2) */}
      <div className="content-wrapper" style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h1 style={{ textAlign: 'center' }}>VideoSync</h1>
        <p style={{ textAlign: 'center', color: '#ffffff', opacity: 0.9 }}>自动配音与音色克隆系统</p>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px' }}>
          <button
            onClick={handleOneClickRun}
            disabled={loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath}
            title={!originalVideoPath ? "请先选择视频" : "自动执行所有步骤"}
            style={{
              padding: '10px 24px',
              background: '#ffffff',
              color: '#7c3aed',
              border: 'none',
              borderRadius: '24px',
              fontSize: '1em',
              fontWeight: 'bold',
              cursor: (loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath) ? 'not-allowed' : 'pointer',
              opacity: (loading || dubbingLoading || generatingSegmentId !== null || !originalVideoPath) ? 0.6 : 1,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            🚀 一键全流程 (识别+翻译+配音+合成)
          </button>
        </div>

        <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', margin: '10px 0', padding: '10px', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '8px', color: '#fff', fontSize: '0.9em', backdropFilter: 'blur(5px)' }}>
          <a
            href="https://space.bilibili.com/32275117"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#fff', textDecoration: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
          >
            天冬制作 Made by Tiandong
          </a>
        </div>

        {/* Hidden Audio Player for controlling playback */}
        <audio
          ref={audioRef}
          style={{ display: 'none' }}
          onEnded={() => setPlayingAudioIndex(null)}
          onError={(e) => {
            console.error("Audio playback error", e);
            setPlayingAudioIndex(null);
            setStatus("播放失败: 无法加载音频文件");
          }}
        />

        {
          status && (
            <div style={{ padding: '10px', background: 'rgba(99,102,241,0.2)', borderRadius: '8px', marginBottom: '10px', textAlign: 'center', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '15px' }}>
              <div>{status}</div>
              {(loading || dubbingLoading || generatingSegmentId !== null) && (
                <button
                  onClick={handleStop}
                  style={{
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '0.9em'
                  }}
                >
                  ⏹ 停止任务
                </button>
              )}
              {!(loading || dubbingLoading || generatingSegmentId !== null) && (
                <button
                  onClick={() => setStatus('')}
                  title="清除消息"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    opacity: 0.6,
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '1.2em',
                    lineHeight: 1
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )
        }

        {/* Progress Bar */}
        {
          (loading || dubbingLoading) && (
            <div style={{ width: '100%', height: '8px', background: '#374151', borderRadius: '4px', marginBottom: '15px', overflow: 'hidden', position: 'relative' }}>
              <div
                className={isIndeterminate ? "progress-bar-indeterminate" : ""}
                style={{
                  height: '100%',
                  background: '#22c55e', // Green
                  width: isIndeterminate ? '30%' : `${progress}%`,
                  transition: isIndeterminate ? 'none' : 'width 0.3s ease-out',
                  position: 'absolute',
                  left: isIndeterminate ? undefined : 0,
                  borderRadius: '4px'
                }}
              />
            </div>
          )
        }

        {/* Main Content Area (Split Resizable) */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', width: '100%' }}>

          {/* Left Column: Video & Upload */}
          <div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '20px', paddingRight: '10px', overflowY: 'auto', height: '100%' }}>
            <VideoUpload
              onFileSelected={(path) => {
                setVideoPath(path);
                setOriginalVideoPath(path);
              }}
              currentPath={videoPath}
              onTimeUpdate={setCurrentTime}
              seekTime={seekTime}
              playUntilTime={playUntilTime}
              videoRef={videoRef}
              onVideoPause={() => setPlayingVideoIndex(null)}
              disabled={loading || dubbingLoading || generatingSegmentId !== null}
              onUserSeek={() => setPlayUntilTime(null)}
            />

            {/* Merged Video Display Section */}
            <div style={{ padding: '15px', background: '#1f2937', borderRadius: '8px', border: '1px solid #374151' }}>
              <h3 style={{ marginTop: 0, marginBottom: '10px' }}>4. 合并后的视频</h3>

              {/* Merged Video Player */}
              {mergedVideoPath && (
                <div style={{ marginBottom: '15px', position: 'relative', background: '#000', borderRadius: '4px', overflow: 'hidden' }}>
                  <video
                    src={mergedVideoPath.startsWith('file:') ? mergedVideoPath : `file:///${encodeURI(mergedVideoPath.replace(/\\/g, '/'))}`}
                    controls
                    style={{ width: '100%', display: 'block' }}
                  />
                  <div
                    style={{
                      padding: '8px',
                      background: 'rgba(0,0,0,0.7)',
                      fontSize: '0.85em',
                      color: '#9ca3af',
                      wordBreak: 'break-all',
                      cursor: 'pointer'
                    }}
                    onClick={() => (window as any).ipcRenderer.invoke('open-external', mergedVideoPath)}
                    title="点击调用系统播放器打开"
                  >
                    {mergedVideoPath.split(/[\\/]/).pop()} <span style={{ color: '#6366f1' }}>(点击打开)</span>
                  </div>
                </div>
              )}

              {!mergedVideoPath && (
                <div style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: '#6b7280',
                  fontSize: '0.9em',
                  border: '2px dashed #374151',
                  borderRadius: '4px',
                  marginBottom: '15px'
                }}>
                  合并完成后将在此显示
                </div>
              )}

              {/* Action Buttons */}
              <button
                onClick={() => handleDubbing()}
                disabled={loading || dubbingLoading || !videoPath || translatedSegments.length === 0}
                className="btn"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: loading || dubbingLoading || translatedSegments.length === 0 ? '#4b5563' : '#10b981',
                  cursor: loading || dubbingLoading || translatedSegments.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: loading || dubbingLoading || translatedSegments.length === 0 ? 0.7 : 1,
                  marginBottom: '10px'
                }}
              >
                {dubbingLoading ? '处理中...' : '开始合并 (生成配音)'}
              </button>
              <button
                onClick={() => (window as any).ipcRenderer.invoke('open-folder', mergedVideoPath)}
                disabled={!mergedVideoPath}
                className="btn"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: mergedVideoPath ? '#6366f1' : '#4b5563',
                  cursor: mergedVideoPath ? 'pointer' : 'not-allowed',
                  opacity: mergedVideoPath ? 1 : 0.7
                }}
              >
                📂 打开文件所在文件夹
              </button>
            </div>
          </div>

          {/* Resizer Divider */}
          <div
            onMouseDown={(e) => { setDragTarget('left'); e.preventDefault(); }}
            style={{
              width: '6px',
              cursor: 'col-resize',
              backgroundColor: dragTarget === 'left' ? '#6366f1' : 'rgba(255,255,255,0.1)',
              margin: '0 2px',
              borderRadius: '3px',
              transition: 'background 0.2s, width 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10
            }}
            title="Drag to resize / 拖拽调整大小"
          >
            <div style={{ width: '2px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />
          </div>

          {/* Center Column: Original Timeline */}
          <div
            style={{ width: timelineWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: '300px', paddingLeft: '10px', paddingRight: '10px' }}
            onScroll={() => handleScroll('timeline')}
          >
            {/* We need to refactor Timeline to expose scroll ref or handle scrolling here. 
               Timeline has "glass-panel" style with overflow.
           */}
            <Timeline
              segments={segments}
              currentTime={currentTime}
              onUpdateSegment={(idx, txt) => {
                const newSegs = [...segments];
                newSegs[idx].text = txt;
                setSegments(newSegs);
              }}
              onPlaySegment={(start, end) => handlePlaySegment(start, end, segments.findIndex(s => s.start === start))}
              domRef={timelineRef}
              onScroll={() => handleScroll('timeline')}
              onASR={handleASR}
              loading={loading || dubbingLoading}
              videoPath={videoPath}
              playingVideoIndex={playingVideoIndex}
              activeIndex={activeIndex}
              onEditStart={setEditingIndex}
              onEditEnd={() => setEditingIndex(null)}
            />
          </div>

          {/* Resizer Divider Middle */}
          <div
            onMouseDown={(e) => { setDragTarget('middle'); e.preventDefault(); }}
            style={{
              width: '6px',
              cursor: 'col-resize',
              backgroundColor: dragTarget === 'middle' ? '#6366f1' : 'rgba(255,255,255,0.1)',
              margin: '0 2px',
              borderRadius: '3px',
              transition: 'background 0.2s, width 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10
            }}
            title="Drag to resize / 拖拽调整大小"
          >
            <div style={{ width: '2px', height: '20px', background: 'rgba(255,255,255,0.2)' }} />
          </div>

          {/* Right Column: Translation Timeline */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: '300px' }}>
            <TranslationPanel
              segments={segments} // Pass original segments to trigger translation
              translatedSegments={translatedSegments}
              setTranslatedSegments={setTranslatedSegments}
              targetLang={targetLang}
              setTargetLang={setTargetLang}
              onTranslate={() => handleTranslate()}
              onTranslateAndDub={handleTranslateAndDub}
              onGenerateAll={() => handleGenerateAllDubbing()}
              onGenerateSingle={handleGenerateSingleDubbing}
              onPlayAudio={handlePlaySegmentAudio}
              generatingSegmentId={generatingSegmentId}
              retranslatingSegmentId={retranslatingSegmentId}
              domRef={translationRef}
              onScroll={() => handleScroll('translation')}
              currentTime={currentTime}
              dubbingLoading={dubbingLoading}
              onReTranslate={handleReTranslate}
              loading={loading}
              onPlaySegment={(start, end) => handlePlaySegment(start, end, segments.findIndex(s => s.start === start))}
              playingAudioIndex={playingAudioIndex}
              playingVideoIndex={playingVideoIndex}
              activeIndex={activeIndex}
              onEditStart={setEditingIndex}
              onEditEnd={() => setEditingIndex(null)}
            />
          </div>
        </div>
      </div >
    </div >
  )
}

export default App
