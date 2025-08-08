import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/contexts/AuthContext';
import { useVideoStore } from '@/store/videoStore';
import { watchVideo } from '@/lib/supabase';
import GlobalHeader from '@/components/GlobalHeader';
import { ExternalLink } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppState } from 'react-native';
import { useRealtimeVideoUpdates } from '@/hooks/useRealtimeVideoUpdates';
import { useTheme } from '@/contexts/ThemeContext';

export default function ViewTab() {
  const { user, profile, refreshProfile } = useAuth();
  const { colors, isDark } = useTheme();
  const { videoQueue, currentVideoIndex, isLoading, error: storeError, fetchVideos, getCurrentVideo, moveToNextVideo, refreshQueue } = useVideoStore();
  const [menuVisible, setMenuVisible] = useState(false);
  const [watchTimer, setWatchTimer] = useState(0);
  const [autoSkipEnabled, setAutoSkipEnabled] = useState(true);
  const autoSkipEnabledRef = useRef(autoSkipEnabled);
  
  // Real-time updates for current video
  const currentVideo = getCurrentVideo();
  const { videoUpdates, coinTransactions, isConnected } = useRealtimeVideoUpdates(
    currentVideo?.video_id,
    user?.id
  );
  
  useEffect(() => {
    autoSkipEnabledRef.current = autoSkipEnabled;
    console.log('🔄 Auto-skip toggle updated:', autoSkipEnabled);
    // DO NOT reset video state when toggle changes - let timer continue running
  }, [autoSkipEnabled]);

  const [isProcessingReward, setIsProcessingReward] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [timerPaused, setTimerPaused] = useState(true);
  const [videoLoadedSuccessfully, setVideoLoadedSuccessfully] = useState(false);
  const [appInBackground, setAppInBackground] = useState(false);
  const [wasPlayingBeforeBackground, setWasPlayingBeforeBackground] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const watchTimerRef = useRef(0);
  const isVideoPlayingRef = useRef(false);
  const videoLoadedRef = useRef(false);
  const timerPausedRef = useRef(true);
  
  const webViewRef = useRef<WebView>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const currentVideoRef = useRef<string | null>(null);
  const rewardProcessedRef = useRef(false);
  
  const videoLoadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const playingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSkipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Add after all useState/useRef declarations and before return
  const prevQueueLength = useRef(videoQueue.length);
  useEffect(() => {
    // If the queue was empty and now has videos, and auto-skip is enabled, move to next video
    if (prevQueueLength.current === 0 && videoQueue.length > 0 && autoSkipEnabled) {
      moveToNextVideo();
    }
    prevQueueLength.current = videoQueue.length;
  }, [videoQueue, autoSkipEnabled]);

  // Tab visibility and background detection
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App going to background
        setAppInBackground(true);
        setWasPlayingBeforeBackground(isVideoPlayingRef.current);
        
        // Force pause video when app goes to background
        if (webViewRef.current && isVideoPlayingRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ type: 'forcePause' }));
        }
      } else if (nextAppState === 'active') {
        // App coming to foreground
        setAppInBackground(false);
        
        // Resume video if it was playing before background
        if (wasPlayingBeforeBackground && webViewRef.current && videoLoadedRef.current) {
          setTimeout(() => {
            webViewRef.current?.postMessage(JSON.stringify({ type: 'forcePlay' }));
          }, 500);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    // Web-specific visibility change detection
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden
        setAppInBackground(true);
        setWasPlayingBeforeBackground(isVideoPlayingRef.current);
        
        if (webViewRef.current && isVideoPlayingRef.current) {
          webViewRef.current.postMessage(JSON.stringify({ type: 'forcePause' }));
        }
      } else {
        // Tab is visible
        setAppInBackground(false);
        
        if (wasPlayingBeforeBackground && webViewRef.current && videoLoadedRef.current) {
          setTimeout(() => {
            webViewRef.current?.postMessage(JSON.stringify({ type: 'forcePlay' }));
          }, 500);
        }
      }
    };

    const handleWindowBlur = () => {
      setAppInBackground(true);
      setWasPlayingBeforeBackground(isVideoPlayingRef.current);
      
      if (webViewRef.current && isVideoPlayingRef.current) {
        webViewRef.current.postMessage(JSON.stringify({ type: 'forcePause' }));
      }
    };

    const handleWindowFocus = () => {
      setAppInBackground(false);
      
      if (wasPlayingBeforeBackground && webViewRef.current && videoLoadedRef.current) {
        setTimeout(() => {
          webViewRef.current?.postMessage(JSON.stringify({ type: 'forcePlay' }));
        }, 500);
      }
    };

    // Add web-specific event listeners
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('blur', handleWindowBlur);
      window.addEventListener('focus', handleWindowFocus);
    }

    return () => {
      subscription?.remove();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('blur', handleWindowBlur);
        window.removeEventListener('focus', handleWindowFocus);
      }
    };
  }, [wasPlayingBeforeBackground]);

  const createHtmlContent = useCallback((youtubeVideoId: string) => {
    console.log('🎬 Creating HTML content for video ID:', youtubeVideoId);
    
    if (!youtubeVideoId || youtubeVideoId.length !== 11 || !/^[a-zA-Z0-9_-]+$/.test(youtubeVideoId)) {
      console.log('🎬 Invalid video ID, creating unavailable content');
      return `
        <!DOCTYPE html>
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="background: #000; margin: 0; padding: 0;">
          <div style="color: white; text-align: center; padding: 50px;">Video unavailable</div>
          <script>
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'videoUnavailable' }));
            }
          </script>
        </body>
        </html>
      `;
    }
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            background: #000; 
            overflow: hidden; 
            position: fixed; 
            width: 100%; 
            height: 100%; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          
          #video-container {
            position: relative;
            width: 100%;
            height: 100%;
          }
          
          #youtube-player { 
            width: 100%; 
            height: 100%; 
            border: none; 
            pointer-events: none;
          }
          
          #security-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            z-index: 1000;
            cursor: pointer;
          }
          
          #play-pause-button {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 68px;
            height: 48px;
            background: rgba(0, 0, 0, 0.8);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 1001;
            opacity: 0.9;
            transition: none;
            pointer-events: auto;
          }
          
          .play-icon {
            width: 0;
            height: 0;
            border-left: 16px solid #fff;
            border-top: 11px solid transparent;
            border-bottom: 11px solid transparent;
            margin-left: 3px;
          }
          
          .pause-icon {
            width: 14px;
            height: 18px;
            position: relative;
          }
          
          .pause-icon::before,
          .pause-icon::after {
            content: '';
            position: absolute;
            width: 4px;
            height: 18px;
            background: #fff;
            border-radius: 1px;
          }
          
          .pause-icon::before { left: 2px; }
          .pause-icon::after { right: 2px; }
          
          .playing #play-pause-button {
            opacity: 0;
            pointer-events: none;
          }
          
          .paused #play-pause-button {
            opacity: 0.9;
            pointer-events: auto;
          }
          
          .timer-complete #play-pause-button {
            opacity: 0;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="video-container" class="paused">
          <iframe
            id="youtube-player"
            src="https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&controls=0&rel=0&modestbranding=1&playsinline=1&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&showinfo=0&theme=dark&enablejsapi=1&mute=0&loop=0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            frameborder="0"
            scrolling="no">
          </iframe>
          
          <div id="security-overlay"></div>
          <div id="play-pause-button"><div class="play-icon"></div></div>
        </div>
        
        <script>
          (function() {
            'use strict';
            
            let player = null;
            let isPlaying = false;
            let playerReady = false;
            let timerCompleted = false;
            let videoUnavailable = false;
            let unavailabilityChecked = false;
            let backgroundPaused = false;
            
            const securityOverlay = document.getElementById('security-overlay');
            const playPauseButton = document.getElementById('play-pause-button');
            const videoContainer = document.getElementById('video-container');
            
            function markVideoUnavailable() {
              if (videoUnavailable || unavailabilityChecked) return;
              
              console.log('🎬 WebView: Marking video as unavailable');
              unavailabilityChecked = true;
              videoUnavailable = true;
              notifyReactNative('videoUnavailable');
            }
            
            function checkIframeAvailability() {
              const iframe = document.getElementById('youtube-player');
              if (!iframe || !iframe.src) {
                markVideoUnavailable();
                return;
              }
              
              iframe.onerror = function() {
                markVideoUnavailable();
              };
              
              setTimeout(() => {
                if (!playerReady && !videoUnavailable) {
                  markVideoUnavailable();
                }
              }, 3000);
            }
            
            checkIframeAvailability();
            
            window.addEventListener('message', function(event) {
              try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                
                if (data.type === 'timerComplete') {
                  timerCompleted = true;
                  forceVideoPause();
                }
                
                if (data.type === 'forcePlay' && playerReady && player && !timerCompleted) {
                  backgroundPaused = false;
                  player.playVideo();
                }
                
                if (data.type === 'forcePause' && playerReady && player) {
                  backgroundPaused = true;
                  player.pauseVideo();
                }
              } catch (e) {
                // Silent error handling
              }
            });
            
            if (!window.YT) {
              const tag = document.createElement('script');
              tag.src = 'https://www.youtube.com/iframe_api';
              tag.onerror = function() {
                markVideoUnavailable();
              };
              
              const firstScriptTag = document.getElementsByTagName('script')[0];
              firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
              
              setTimeout(() => {
                if (!window.YT || !window.YT.Player) {
                  markVideoUnavailable();
                }
              }, 2500);
            } else {
              setTimeout(() => window.onYouTubeIframeAPIReady(), 100);
            }
            
            window.onYouTubeIframeAPIReady = function() {
              if (videoUnavailable) return;
              
              try {
                player = new YT.Player('youtube-player', {
                  events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange,
                    'onError': onPlayerError
                  }
                });
              } catch (e) {
                markVideoUnavailable();
              }
            };
            
            function onPlayerReady(event) {
              if (videoUnavailable) return;
              
              playerReady = true;
              console.log('🎬 WebView: Player ready');
              
              try {
                const videoData = event.target.getVideoData();
                console.log('🎬 WebView: Video data:', videoData);
                
                if (!videoData || 
                    !videoData.title || 
                    videoData.title === '' || 
                    videoData.title === 'YouTube' ||
                    videoData.errorCode) {
                  console.log('🎬 WebView: Video unavailable - invalid data');
                  markVideoUnavailable();
                  return;
                }
                
                console.log('🎬 WebView: Starting video playback');
                event.target.playVideo();
                notifyReactNative('videoLoaded');
                
              } catch (e) {
                console.log('🎬 WebView: Error in onPlayerReady:', e);
                markVideoUnavailable();
              }
            }
            
            function onPlayerStateChange(event) {
              if (videoUnavailable) return;
              
              const state = event.data;
              console.log('🎬 WebView: Player state change:', state);
              
              switch (state) {
                case YT.PlayerState.PLAYING:
                  console.log('🎬 WebView: Video playing');
                  updatePlayerState(true);
                  notifyReactNative('videoPlaying');
                  break;
                  
                case YT.PlayerState.PAUSED:
                  console.log('🎬 WebView: Video paused');
                  updatePlayerState(false);
                  notifyReactNative('videoPaused');
                  break;
                  
                case YT.PlayerState.BUFFERING:
                  console.log('🎬 WebView: Video buffering');
                  break;
                  
                case YT.PlayerState.ENDED:
                  console.log('🎬 WebView: Video ended');
                  updatePlayerState(false);
                  notifyReactNative('videoEnded');
                  break;
                  
                case YT.PlayerState.CUED:
                  console.log('🎬 WebView: Video cued');
                  break;
              }
            }
            
            function onPlayerError(event) {
              const errorCode = event.data;
              const unavailableErrors = [2, 5, 100, 101, 150];
              
              if (unavailableErrors.includes(errorCode)) {
                markVideoUnavailable();
              } else {
                notifyReactNative('videoError', { errorCode });
              }
            }
            
            function updatePlayerState(playing) {
              isPlaying = playing;
              const icon = playPauseButton.querySelector('.play-icon, .pause-icon');
              
              if (playing) {
                icon.className = 'pause-icon';
                videoContainer.classList.add('playing');
                videoContainer.classList.remove('paused');
              } else {
                icon.className = 'play-icon';
                videoContainer.classList.add('paused');
                videoContainer.classList.remove('playing');
              }
            }
            
            function togglePlayPause() {
              if (!playerReady || !player || timerCompleted || videoUnavailable || backgroundPaused) return;
              
              try {
                if (isPlaying) {
                  player.pauseVideo();
                } else {
                  player.playVideo();
                }
              } catch (e) {
                // Silent error handling
              }
            }
            
            function forceVideoPause() {
              if (playerReady && player) {
                try {
                  player.pauseVideo();
                  videoContainer.classList.add('timer-complete');
                } catch (e) {
                  // Silent error handling
                }
              }
            }
            
            function notifyReactNative(type, data = {}) {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ 
                  type: type, 
                  ...data 
                }));
              }
            }
            
            playPauseButton.addEventListener('click', function(e) {
              e.stopPropagation();
              togglePlayPause();
            });
            
            securityOverlay.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (!timerCompleted) togglePlayPause();
            });
            
            document.addEventListener('contextmenu', e => e.preventDefault());
            document.addEventListener('selectstart', e => e.preventDefault());
            
            document.addEventListener('keydown', function(e) {
              if (timerCompleted || backgroundPaused) {
                e.preventDefault();
                return false;
              }
              
              if (e.code === 'Space') {
                e.preventDefault();
                togglePlayPause();
                return false;
              }
              
              if (e.ctrlKey || e.metaKey || e.altKey) {
                e.preventDefault();
                return false;
              }
            });
          })();
        </script>
      </body>
      </html>
    `;
  }, []);

  const shouldResumeOnFocus = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (user && videoQueue.length === 0) {
        fetchVideos(user.id).catch(error => {
          console.error('❌ Error fetching videos in focus effect:', error);
        });
      }
      // Set flag to resume on focus
      shouldResumeOnFocus.current = true;
      // Try to resume immediately if possible
      if (webViewRef.current && videoLoadedRef.current && !isVideoPlayingRef.current) {
        webViewRef.current.postMessage(JSON.stringify({ type: 'forcePlay' }));
        shouldResumeOnFocus.current = false;
      }
    }, [fetchVideos, user, videoQueue.length])
  );

  // Add smooth video transition state
  const [nextVideo, setNextVideo] = useState(null);
  const [isVideoTransitioning, setIsVideoTransitioning] = useState(false);

  // Smooth video transition function
  const smoothTransitionToNextVideo = async () => {
    if (!currentVideo || !user) return;
    
    setIsVideoTransitioning(true);
    
    try {
      // Process reward first using the new watchVideo function
      const result = await watchVideo(user.id, currentVideo.video_id, watchTimerRef.current || 0, false);
      
      if (result.error) {
        console.error('Error processing video watch:', result.error);
        throw new Error(result.error.message || 'Failed to process video watch');
      }
      
      if (!result.data?.success) {
        console.error('Video watch failed:', result.data?.error);
        throw new Error(result.data?.error || 'Failed to process video watch');
      }
      
      await refreshProfile();
      
      // Show completion status if video reached target
      if (result.data.video_completed) {
        console.log('Video completed! Target views reached for video:', currentVideo.video_id);
      }
      
      // Move to next video immediately after processing reward
      console.log('⏭️ Moving to next video after reward processing');
      moveToNextVideo();
      
      // Check if we actually moved to a different video
      const nextVideoData = getCurrentVideo();
      if (nextVideoData && nextVideoData.video_id !== currentVideo.video_id) {
        console.log('⏭️ Successfully moved to next video:', nextVideoData.video_id);
        setNextVideo(nextVideoData);
        
        // Smooth transition - fade out current video
        setTimeout(() => {
          setNextVideo(null);
          setIsVideoTransitioning(false);
        }, 300); // 300ms fade transition
      } else {
        console.log('⏭️ No different video found, ending transition');
        setIsVideoTransitioning(false);
      }
    } catch (error) {
      console.error('❌ Error processing reward:', error);
      setIsVideoTransitioning(false);
    }
  };

  // Replace the old handleVideoCompletion with smooth version
  const handleVideoCompletion = async () => {
    if (!currentVideo || !user) return;
    setIsProcessingReward(true);
    
    if (autoSkipEnabled) {
      await smoothTransitionToNextVideo();
    }
    
    setIsProcessingReward(false);
  };

  // Replace skipToNextVideo with smooth version
  const skipToNextVideo = async () => {
    console.log('⏭️ skipToNextVideo called, autoSkipEnabled:', autoSkipEnabled);
    
    if (autoSkipEnabled) {
      await smoothTransitionToNextVideo();
    } else {
      console.log('⏭️ Auto-skip disabled, moving to next video directly');
      moveToNextVideo();
    }
    
    if (videoQueue.length === 0) {
      console.log('⏭️ Queue empty, refreshing...');
      await refreshQueue(user.id);
      showNotification('All videos watched, queue will loop', 'info');
    }
  };

  // Notification system
  const showNotification = (message: string, type: string = 'info') => {
    // Implement your notification system here (toast, modal, etc.)
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    // Check if this is actually a new video (different ID or different index)
    const isNewVideo = currentVideoRef.current !== currentVideo.video_id;
    
    console.log('🎬 Video change check:', { 
      currentRef: currentVideoRef.current, 
      newVideoId: currentVideo.video_id, 
      isNewVideo,
      videoTitle: currentVideo.title 
    });
    
    // Only reset timer state when video actually changes (not when auto-skip toggle changes)
    if (currentVideoRef.current !== currentVideo.video_id) {
      console.log('🎬 Resetting timer for video change');
      
      // Start smooth transition with shorter delay
      setIsTransitioning(true);
      
      // Shorter delay for smoother transition
      setTimeout(() => {
        currentVideoRef.current = currentVideo.video_id;
        setIsTransitioning(false);
      }, 50); // Reduced from 100ms to 50ms for smoother feel

      console.log('🎬 Switching to new video:', currentVideo.video_id, 'Title:', currentVideo.title);
      
      // Clear timers more gracefully
      if (timerRef.current) {
        clearInterval(timerRef.current as NodeJS.Timeout);
        timerRef.current = null;
      }

      if (videoLoadTimeoutRef.current) {
        clearTimeout(videoLoadTimeoutRef.current as NodeJS.Timeout);
        videoLoadTimeoutRef.current = null;
      }
      
      if (playingTimeoutRef.current) {
        clearTimeout(playingTimeoutRef.current as NodeJS.Timeout);
        playingTimeoutRef.current = null;
      }

      if (autoSkipTimeoutRef.current) {
        clearTimeout(autoSkipTimeoutRef.current as NodeJS.Timeout);
        autoSkipTimeoutRef.current = null;
      }

      // Reset state more smoothly
      setWatchTimer(0);
      watchTimerRef.current = 0;
      setIsProcessingReward(false);
      setVideoError(false);
      setIsVideoPlaying(false);
      isVideoPlayingRef.current = false;
      setTimerPaused(true);
      timerPausedRef.current = true;
      setVideoLoadedSuccessfully(false);
      videoLoadedRef.current = false;
      rewardProcessedRef.current = false;
    } else {
      console.log('🎬 Same video, minimal reset - timer continues running');
      // DO NOT reset timer state for same video - let it continue running
      return; // Exit early to prevent timer reset
    }
    
      console.log('🎬 Timer state reset for new video:', {
        watchTimer: watchTimerRef.current,
        isVideoPlaying: isVideoPlayingRef.current,
        timerPaused: timerPausedRef.current,
        videoLoaded: videoLoadedRef.current
      });

      // Set timeout for video loading - but only skip if auto-skip is enabled
      videoLoadTimeoutRef.current = setTimeout(() => {
        if (!videoLoadedRef.current) {
          console.log('🎬 Video load timeout - checking auto-skip setting:', autoSkipEnabledRef.current);
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            console.log('SKIP: videoLoadTimeout - auto-skip enabled, skipping');
            skipToNextVideo();
          } else {
            console.log('SKIP: videoLoadTimeout - auto-skip disabled, not skipping');
          }
        }
      }, 3000);

      // Early detection timeout - only skip if auto-skip is enabled
      const earlyDetectionTimeout = setTimeout(() => {
        if (!videoLoadedRef.current && !videoError) {
          console.log('🎬 Early detection timeout - checking auto-skip setting:', autoSkipEnabledRef.current);
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            console.log('SKIP: earlyDetectionTimeout - auto-skip enabled, skipping');
            skipToNextVideo();
          } else {
            console.log('SKIP: earlyDetectionTimeout - auto-skip disabled, not skipping');
          }
        }
      }, 1500);

      timerRef.current = setInterval(() => {
      const isPaused = timerPausedRef.current;
      const isLoaded = videoLoadedRef.current;
      const isPlaying = isVideoPlayingRef.current;
      
      console.log('⏱️ Timer tick:', { isPaused, isLoaded, isPlaying, currentTime: watchTimerRef.current });
      
      if (!isPaused && isLoaded && isPlaying) {
        watchTimerRef.current += 1;
        const newTime = watchTimerRef.current;
        
        setWatchTimer(newTime);
        
        const targetDuration = currentVideo.duration_seconds;
        
        console.log('⏱️ Timer advancing:', newTime, '/', targetDuration);
        
        if (newTime >= targetDuration) {
          console.log('⏱️ Timer completed, processing reward');
          if (webViewRef.current) {
            webViewRef.current.postMessage(JSON.stringify({ type: 'timerComplete' }));
          }
          
          if (!rewardProcessedRef.current) {
            rewardProcessedRef.current = true;
            // Only auto-skip if enabled at this exact moment
            if (autoSkipEnabledRef.current) {
              handleVideoCompletion();
            } else {
              // Do not skip, just process reward and stop
              setIsProcessingReward(false);
            }
          }
          
          if (timerRef.current) {
            clearInterval(timerRef.current as NodeJS.Timeout);
            timerRef.current = null;
          }
        }
      } else {
        console.log('⏱️ Timer blocked:', { isPaused, isLoaded, isPlaying });
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current as NodeJS.Timeout);
        timerRef.current = null;
      }
      
      if (videoLoadTimeoutRef.current) {
        clearTimeout(videoLoadTimeoutRef.current as NodeJS.Timeout);
        videoLoadTimeoutRef.current = null;
      }
      
      if (playingTimeoutRef.current) {
        clearTimeout(playingTimeoutRef.current as NodeJS.Timeout);
        playingTimeoutRef.current = null;
      }

      if (autoSkipTimeoutRef.current) {
        clearTimeout(autoSkipTimeoutRef.current as NodeJS.Timeout);
        autoSkipTimeoutRef.current = null;
      }

      clearTimeout(earlyDetectionTimeout);
    };
  }, [currentVideo?.video_id, handleVideoCompletion, skipToNextVideo]);

  // Periodic cleanup and real-time updates
  useEffect(() => {
    // Trigger periodic cleanup every 5 minutes
    const cleanupInterval = setInterval(async () => {
      try {
        // The triggerPeriodicCleanup function is no longer needed as per the new RPCs
        // Keeping this interval for now, but it will be removed if no other RPCs are added
        // await triggerPeriodicCleanup(); 
        console.log('🧹 Periodic cleanup completed (no longer needed)');
      } catch (error) {
        console.error('Error during periodic cleanup:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(cleanupInterval);
  }, []);

  // Handle real-time video updates
  useEffect(() => {
    if (videoUpdates && currentVideo) {
      console.log('📹 Real-time video update received:', videoUpdates);
      
      // Update local state if video completion status changes
      if (videoUpdates.completed !== undefined && videoUpdates.completed) {
        console.log('🎯 Video completed via real-time update!');
      }
      
      // Refresh queue if video was completed
      if (videoUpdates.completed && user) {
        setTimeout(() => {
          refreshQueue(user.id);
        }, 1000);
      }
    }
  }, [videoUpdates, currentVideo, user, refreshQueue]);

  // Handle real-time coin transaction updates
  useEffect(() => {
    // The coinTransactions state is no longer populated by real-time updates
    // This effect is now redundant and can be removed if no other real-time data is expected.
    // Keeping it for now as it was part of the original file.
    if (coinTransactions.length > 0 && currentVideo) {
      console.log('💰 Real-time coin transaction update:', coinTransactions.length, 'transactions');
      
      // Only refresh profile if we have new transactions (prevent infinite loop)
      const hasNewTransactions = coinTransactions.some(tx => 
        tx.created_at && new Date(tx.created_at) > new Date(Date.now() - 5000) // Only very recent transactions (last 5 seconds)
      );
      
      if (hasNewTransactions && user) {
        console.log('💰 Refreshing profile due to new transactions');
        console.log('🔍 DEBUG: About to call refreshProfile, autoSkipEnabledRef.current =', autoSkipEnabledRef.current);
        // Add a small delay to prevent rapid refreshes
        setTimeout(() => {
          refreshProfile();
        }, 1000);
      }
    }
  }, [coinTransactions, currentVideo, user, refreshProfile]);

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('📱 WebView message received:', data.type);
      
      switch (data.type) {
        case 'videoLoaded':
          console.log('📱 Video loaded successfully');
          setVideoLoadedSuccessfully(true);
          videoLoadedRef.current = true;
          setVideoError(false);
          
          // End transition smoothly
          setTimeout(() => {
            setIsTransitioning(false);
          }, 200);
          
          if (videoLoadTimeoutRef.current) {
            clearTimeout(videoLoadTimeoutRef.current as NodeJS.Timeout);
            videoLoadTimeoutRef.current = null;
          }
          
          // Set timeout for video playing - only skip if auto-skip is enabled
          playingTimeoutRef.current = setTimeout(() => {
            if (!isVideoPlayingRef.current && !videoError && videoLoadedRef.current) {
              console.log('📱 Video not playing after load timeout - checking auto-skip setting:', autoSkipEnabledRef.current);
              setVideoError(true);
              if (autoSkipEnabledRef.current) {
                console.log('SKIP: videoLoaded timeout - auto-skip enabled, skipping');
                skipToNextVideo();
              } else {
                console.log('SKIP: videoLoaded timeout - auto-skip disabled, not skipping');
              }
            }
          }, 5000) as NodeJS.Timeout;

          if (shouldResumeOnFocus.current && !isVideoPlayingRef.current) {
            if (webViewRef.current) {
              webViewRef.current.postMessage(JSON.stringify({ type: 'forcePlay' }));
              shouldResumeOnFocus.current = false;
            }
          }
          
          break;

        case 'videoPlaying':
          console.log('📱 Video started playing');
          if (playingTimeoutRef.current) {
            clearTimeout(playingTimeoutRef.current as NodeJS.Timeout);
            playingTimeoutRef.current = null;
          }
          
          setIsVideoPlaying(true);
          isVideoPlayingRef.current = true;
          setTimerPaused(false);
          timerPausedRef.current = false;
          setVideoLoadedSuccessfully(true);
          videoLoadedRef.current = true;
          setVideoError(false);
          
          // Ensure timer is running after skip or video change
          if (!timerRef.current) {
            console.log('⏱️ Timer was not running, starting timer interval');
            timerRef.current = setInterval(() => {
              const isPaused = timerPausedRef.current;
              const isLoaded = videoLoadedRef.current;
              const isPlaying = isVideoPlayingRef.current;
              
              console.log('⏱️ Timer tick:', { isPaused, isLoaded, isPlaying, currentTime: watchTimerRef.current });
              
              if (!isPaused && isLoaded && isPlaying) {
                watchTimerRef.current += 1;
                const newTime = watchTimerRef.current;
                setWatchTimer(newTime);
                const targetDuration = currentVideo.duration_seconds;
                console.log('⏱️ Timer advancing:', newTime, '/', targetDuration);
                if (newTime >= targetDuration) {
                  console.log('⏱️ Timer completed, processing reward');
                  if (webViewRef.current) {
                    webViewRef.current.postMessage(JSON.stringify({ type: 'timerComplete' }));
                  }
                  if (!rewardProcessedRef.current) {
                    rewardProcessedRef.current = true;
                    // Only auto-skip if enabled at this exact moment
                    if (autoSkipEnabledRef.current) {
                      handleVideoCompletion();
                    } else {
                      // Do not skip, just process reward and stop
                      setIsProcessingReward(false);
                    }
                  }
                  if (timerRef.current) {
                    clearInterval(timerRef.current as NodeJS.Timeout);
                    timerRef.current = null;
                  }
                }
              } else {
                console.log('⏱️ Timer blocked:', { isPaused, isLoaded, isPlaying });
              }
            }, 1000) as NodeJS.Timeout;
          }
          
          console.log('📱 Timer state after video playing:', {
            isVideoPlaying: isVideoPlayingRef.current,
            timerPaused: timerPausedRef.current,
            videoLoaded: videoLoadedRef.current,
            timerExists: !!timerRef.current
          });
          
          break;
          
        case 'videoPaused':
          console.log('📱 Video paused');
          setIsVideoPlaying(false);
          isVideoPlayingRef.current = false;
          setTimerPaused(true);
          timerPausedRef.current = true;

          if (shouldResumeOnFocus.current && !isVideoPlayingRef.current) {
            if (webViewRef.current) {
              webViewRef.current.postMessage(JSON.stringify({ type: 'forcePlay' }));
              shouldResumeOnFocus.current = false;
            }
          }
          break;
          
        case 'videoEnded':
          console.log('📱 Video ended - checking auto-skip setting:', autoSkipEnabledRef.current);
          setIsVideoPlaying(false);
          isVideoPlayingRef.current = false;
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            skipToNextVideo();
          }
          break;
          
        case 'videoUnavailable':
          console.log('📱 Video unavailable - checking auto-skip setting:', autoSkipEnabledRef.current);
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            skipToNextVideo();
          }
          break;
          
        case 'videoError':
          console.log('📱 Video error - checking auto-skip setting:', autoSkipEnabledRef.current, data);
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            skipToNextVideo();
          }
          break;
        case 'timerComplete':
          if (!rewardProcessedRef.current) {
            rewardProcessedRef.current = true;
            if (autoSkipEnabledRef.current) {
              handleVideoCompletion();
            } else {
              setIsProcessingReward(false);
            }
          }
          break;
      }
    } catch (e) {
      console.log('📱 Error parsing WebView message:', e);
      // Only skip on parse error if auto-skip is enabled
      if (autoSkipEnabledRef.current) {
        console.log('SKIP: WebView message parse error - auto-skip enabled, skipping');
        setTimeout(() => {
          skipToNextVideo();
        }, 1000);
      } else {
        console.log('SKIP: WebView message parse error - auto-skip disabled, not skipping');
      }
    }
  };

  const handleManualSkip = () => {
    if (!currentVideo) return;

    console.log('📱 Manual skip button pressed');

    if (autoSkipTimeoutRef.current) {
      clearTimeout(autoSkipTimeoutRef.current as NodeJS.Timeout);
      autoSkipTimeoutRef.current = null;
    }

    if (videoLoadTimeoutRef.current) {
      clearTimeout(videoLoadTimeoutRef.current as NodeJS.Timeout);
      videoLoadTimeoutRef.current = null;
    }
    if (playingTimeoutRef.current) {
      clearTimeout(playingTimeoutRef.current as NodeJS.Timeout);
      playingTimeoutRef.current = null;
    }

    const targetDuration = currentVideo.duration_seconds;
    
    if (watchTimerRef.current >= targetDuration && !rewardProcessedRef.current) {
      console.log('📱 Manual skip - processing reward first');
      rewardProcessedRef.current = true;
      handleVideoCompletion();
    } else {
      console.log('SKIP: [handleManualSkip] - manual skip button pressed, always skip regardless of auto-skip setting');
      // Force move to next video immediately for manual skip
      moveToNextVideo();
    }
  };

  const handleOpenYouTube = () => {
    if (currentVideo && currentVideo.youtube_url) {
      const youtubeUrl = `https://www.youtube.com/watch?v=${currentVideo.youtube_url}`;
      Linking.openURL(youtubeUrl).catch(err => {
        Alert.alert('Error', 'Could not open YouTube video');
      });
    }
  };

  const getRemainingTime = () => {
    if (!currentVideo) return 0;
    const targetDuration = currentVideo.duration_seconds || 0;
    return Math.max(0, targetDuration - (watchTimerRef.current || 0));
  };

  const getButtonState = () => {
    const targetDuration = currentVideo?.duration_seconds || 0;
    
    if (watchTimerRef.current >= targetDuration) {
      if (isProcessingReward) {
        return { text: 'PROCESSING REWARD...', style: styles.processingButton, disabled: false };
      } else if (rewardProcessedRef.current) {
        return { text: `COINS EARNED! TAP TO CONTINUE`, style: styles.earnedButton, disabled: false };
      } else {
        return { text: `EARN ${currentVideo?.coin_reward || 0} COINS NOW`, style: styles.earnButton, disabled: false };
      }
    }
    
    if (videoError) {
      return { 
        text: 'VIDEO ERROR - TAP TO SKIP', 
        style: styles.errorButton, 
        disabled: false 
      };
    }
    
    if (!videoLoadedSuccessfully) {
      return { 
        text: 'TAP TO SKIP', 
        style: styles.loadingButton, 
        disabled: false 
      };
    }
    
    return { 
      text: `SKIP VIDEO`, 
      style: styles.skipButton, 
      disabled: false 
    };
  };

  if (isLoading) {
    console.log('📱 View tab showing loading state');
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <GlobalHeader 
          title="View" 
          showCoinDisplay={true}
          menuVisible={menuVisible} 
          setMenuVisible={setMenuVisible} 
        />
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.text }]}>Loading videos...</Text>
          {storeError && (
            <Text style={[styles.errorText, { color: colors.error }]}>Error: {storeError}</Text>
          )}
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => user && fetchVideos(user.id)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!currentVideo) {
    console.log('📱 No current video available, queue length:', videoQueue.length);
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <GlobalHeader 
          title="View" 
          showCoinDisplay={true}
          menuVisible={menuVisible} 
          setMenuVisible={setMenuVisible} 
        />
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.text }]}>
            {videoQueue.length === 0 ? 'No videos available' : 'Loading next video...'}
          </Text>
          <TouchableOpacity 
            style={[styles.refreshButton, { backgroundColor: colors.primary }]}
            onPress={() => user && fetchVideos(user.id)}
          >
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
          {storeError && (
            <Text style={[styles.errorText, { color: colors.error }]}>Error: {storeError}</Text>
          )}
        </View>
      </View>
    );
  }

  const buttonState = getButtonState();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlobalHeader 
        title="View" 
        showCoinDisplay={true}
        menuVisible={menuVisible} 
        setMenuVisible={setMenuVisible} 
      />
      
      <View style={[
        styles.videoContainer, 
        isVideoTransitioning && styles.videoContainerTransitioning
      ]}>
        <WebView
          ref={webViewRef}
          source={{ html: createHtmlContent(currentVideo?.youtube_url || '') }}
          style={[
            styles.webView,
            isVideoTransitioning && styles.webViewTransitioning
          ]}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          onError={() => {
            console.log('📱 WebView onError - checking auto-skip setting:', autoSkipEnabledRef.current);
            setVideoError(true);
            if (autoSkipEnabledRef.current) {
              console.log('SKIP: WebView onError - auto-skip enabled, skipping');
              skipToNextVideo();
            } else {
              console.log('SKIP: WebView onError - auto-skip disabled, not skipping');
            }
          }}
          onHttpError={() => {
            console.log('📱 WebView onHttpError - checking auto-skip setting:', autoSkipEnabledRef.current);
            setVideoError(true);
            if (autoSkipEnabledRef.current) {
              console.log('SKIP: WebView onHttpError - auto-skip enabled, skipping');
              skipToNextVideo();
            } else {
              console.log('SKIP: WebView onHttpError - auto-skip disabled, not skipping');
            }
          }}
          key={`video-${currentVideo?.video_id || 'default'}`}
          startInLoadingState={false}
          renderLoading={() => null}
        />
      </View>

      <View style={[styles.controlsContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.youtubeButtonContainer, { backgroundColor: colors.surface }]}>
          <ExternalLink size={20} color="#FF0000" />
          <TouchableOpacity onPress={handleOpenYouTube} style={styles.youtubeTextButton}>
            <Text style={[styles.youtubeButtonText, { color: colors.text }]}>Open on YouTube</Text>
          </TouchableOpacity>
          <View style={styles.autoPlayContainer}>
            <Text style={[styles.autoPlayText, { color: colors.textSecondary }]}>Auto Skip</Text>
            <TouchableOpacity 
              style={[styles.toggle, { backgroundColor: colors.border }]} 
              onPress={() => setAutoSkipEnabled(!autoSkipEnabled)}
            >
              <View style={[
                styles.toggleSlider, 
                autoSkipEnabled && [styles.toggleActive, { backgroundColor: colors.success }]
              ]} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={[
              styles.statNumber, 
              { color: colors.text },
              isProcessingReward && [styles.statNumberProcessing, { color: colors.warning }]
            ]}>
              {isProcessingReward ? '⏳' : getRemainingTime()}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {isProcessingReward ? 'Processing...' : 'Seconds to earn coins'}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[
              styles.statNumber, 
              { color: colors.text },
              isProcessingReward && [styles.statNumberProcessing, { color: colors.warning }]
            ]}>
              {isProcessingReward ? '⏳' : (currentVideo?.coin_reward || '?')}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {isProcessingReward ? 'Processing...' : 'Coins to earn'}
            </Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.skipButtonBase, buttonState.style]}
          onPress={handleManualSkip}
          disabled={buttonState.disabled}
        >
          <Text style={styles.skipButtonText}>
            {buttonState.text}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  refreshButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  videoContainer: {
    height: 250,
    backgroundColor: 'black',
    position: 'relative',
  },
  videoContainerTransitioning: {
    opacity: 0.8,
  },
  webView: {
    flex: 1,
  },
  webViewTransitioning: {
    opacity: 0.6,
  },
  controlsContainer: {
    flex: 1,
    padding: 20,
  },
  youtubeButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 24,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  youtubeTextButton: {
    flex: 1,
    marginLeft: 8,
  },
  youtubeButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  autoPlayContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  autoPlayText: {
    fontSize: 14,
    marginRight: 8,
    fontWeight: '500',
  },
  toggle: {
    width: 50,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    padding: 2,
  },
  toggleSlider: {
    width: 20,
    height: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleActive: {
    alignSelf: 'flex-end',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  statNumberProcessing: {
    // Color will be applied dynamically
  },
  statLabel: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  skipButtonBase: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  earnButton: {
    backgroundColor: '#00D4AA',
  },
  earnedButton: {
    backgroundColor: '#00BFA5',
  },
  processingButton: {
    backgroundColor: '#FF9500',
  },
  skipButton: {
    backgroundColor: '#FF6B6B',
  },
  loadingButton: {
    backgroundColor: '#9E9E9E',
  },
  errorButton: {
    backgroundColor: '#F44336',
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  testButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  testButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
