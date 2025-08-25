import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, Dimensions, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/contexts/AuthContext';
import { useVideoStore } from '@/store/videoStore';
import { useCustomAlert } from '@/hooks/useCustomAlert';
import { useRealtimeVideoUpdates } from '@/hooks/useRealtimeVideoUpdates';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '@/contexts/ThemeContext';
import { ExternalLink } from 'lucide-react-native';
import GlobalHeader from '@/components/GlobalHeader';
import { watchVideoAndEarnCoins } from '@/lib/supabase';

// Responsive helpers
const { width: screenWidth } = Dimensions.get('window');
const isTinyScreen = screenWidth < 340;
const isSmallScreen = screenWidth < 380;
const isTablet = screenWidth >= 768;

export default function ViewTab() {
  const { user, refreshProfile } = useAuth();
  const { showSuccess, showError, showInfo } = useCustomAlert();
  const { 
    videoQueue, 
    fetchVideos, 
    getCurrentVideo, 
    moveToNextVideo, 
    clearQueue,
    shouldSkipCurrentVideo,
    refreshQueue,
    isLoading,
  } = useVideoStore();
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const { colors, isDark } = useTheme();

  // Core state
  const [menuVisible, setMenuVisible] = useState(false);
  const [watchTimer, setWatchTimer] = useState(0);
  const [autoSkipEnabled, setAutoSkipEnabled] = useState(true);
  const [isProcessingReward, setIsProcessingReward] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [progress, setProgress] = useState(0);
  const [showSkipButton, setShowSkipButton] = useState(false);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [showRefreshButton, setShowRefreshButton] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [suppressAutoPlay, setSuppressAutoPlay] = useState(false);
  const [videoLoadedSuccessfully, setVideoLoadedSuccessfully] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isVideoTransitioning, setIsVideoTransitioning] = useState(false);
  const [webViewReady, setWebViewReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Note: watchVideoAndEarnCoins is now imported from @/lib/supabase
  
  // Refs
  const isVideoPlayingRef = useRef(false);
  const timerPausedRef = useRef(false);
  const isTabFocusedRef = useRef(false);
  const isAppForegroundRef = useRef(true);
  const rewardProcessedRef = useRef(false);
  const webViewRef = useRef<WebView>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastVideoIdRef = useRef<string | null>(null);
  const suppressAutoPlayRef = useRef(false);
  const videoLoadTimeoutRef = useRef<any>(null);
  const videoLoadedRef = useRef(false);
  const timerRef = useRef<any>(null);
  const watchTimerRef = useRef(0);
  const autoSkipEnabledRef = useRef(true);
  const currentVideoRef = useRef<any>(null);
  
  // Get current video
  const currentVideo = getCurrentVideo();
  
  // Check for suppress auto-play parameter
  useEffect(() => {
    if (searchParams?.suppressAutoPlay === 'true') {
      suppressAutoPlayRef.current = true;
      setSuppressAutoPlay(true);
      // Clear the parameter to avoid persisting it
      router.setParams({ suppressAutoPlay: undefined });
    }
  }, [searchParams, router]);
  
  // Real-time updates
  const { videoUpdates, coinTransactions, isConnected } = useRealtimeVideoUpdates(
    currentVideo?.video_id,
    user?.id
  );

  // Authentication guard
  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }
  }, [user, router]);
  
  // Update refs when state changes
  useEffect(() => {
    autoSkipEnabledRef.current = autoSkipEnabled;
  }, [autoSkipEnabled]);

  useEffect(() => {
    isVideoPlayingRef.current = isVideoPlaying;
  }, [isVideoPlaying]);

  useEffect(() => {
    timerPausedRef.current = timerPaused;
  }, [timerPaused]);

  useEffect(() => {
    videoLoadedRef.current = videoLoadedSuccessfully;
  }, [videoLoadedSuccessfully]);

  // App state handling
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      console.log('📱 APP STATE CHANGE:', nextAppState);
      const isActive = nextAppState === 'active';
      
      if (!isActive) {
        console.log('🔄 APP GOING TO BACKGROUND - pausing everything');
        // App going to background - pause everything
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (webViewRef.current) {
          console.log('⏸️ SENDING pauseVideo (app background)');
          const jsCode = `
            (function() {
              console.log('🔵 Injected JS executing pauseVideo');
              if (typeof window.handleMessage === 'function') {
                console.log('✅ handleMessage found, calling it');
                window.handleMessage({ data: JSON.stringify({ type: 'pauseVideo' }) });
              } else {
                console.log('❌ handleMessage not found');
              }
            })();
          `;
          webViewRef.current.injectJavaScript(jsCode);
        }
      } else if (isTabFocusedRef.current && currentVideo) {
        console.log('🔄 APP RETURNING TO FOREGROUND - attempting auto resume');
        console.log('📊 Foreground state:', {
          tabFocused: isTabFocusedRef.current,
          videoLoaded: videoLoadedRef.current,
          rewardProcessed: rewardProcessedRef.current
        });
        
        // App returning to foreground and tab is focused - force auto resume
        if (webViewRef.current) {
          console.log('▶️ SENDING playVideo (app foreground)');
          const jsCode = `
            (function() {
              console.log('🔵 Injected JS executing playVideo');
              if (typeof window.handleMessage === 'function') {
                console.log('✅ handleMessage found, calling it');
                window.handleMessage({ data: JSON.stringify({ type: 'playVideo' }) });
              } else {
                console.log('❌ handleMessage not found');
              }
            })();
          `;
          webViewRef.current.injectJavaScript(jsCode);
          
          if (!isVideoPlayingRef.current) {
            setIsVideoPlaying(true);
            setTimerPaused(false);
            timerPausedRef.current = false;
          }
        }
      } else {
        console.log('❌ NOT resuming on foreground:', {
          tabFocused: isTabFocusedRef.current,
          hasCurrentVideo: !!currentVideo
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [currentVideo]);

  // Tab focus handling
  useFocusEffect(
    useCallback(() => {
      console.log('🎯 TAB FOCUS: Video tab gained focus');
      console.log('📊 Current state:', {
        currentVideo: currentVideo?.video_id || 'none',
        isVideoPlaying: isVideoPlayingRef.current,
        timerPaused: timerPausedRef.current,
        rewardProcessed: rewardProcessedRef.current,
        suppressAutoPlay: suppressAutoPlayRef.current,
        webViewReady: webViewReady
      });
      
      isTabFocusedRef.current = true;
      
      // Check if we should suppress auto-play (coming back from edit/promote/delete)
      if (suppressAutoPlayRef.current) {
        console.log('🚫 SUPPRESSING auto-play due to suppressAutoPlay flag');
        suppressAutoPlayRef.current = false;
        setSuppressAutoPlay(false);
        return; // Skip auto-play this time
      }
      
      // Simple auto-play when tab becomes focused
      if (currentVideo && webViewRef.current && !suppressAutoPlayRef.current) {
        if (webViewReady) {
          console.log('▶️ SENDING playVideo message to WebView');
          const jsCode = `
            (function() {
              console.log('🔵 Injected JS executing playVideo from tab focus');
              if (typeof window.handleMessage === 'function') {
                console.log('✅ handleMessage found, calling it');
                window.handleMessage({ data: JSON.stringify({ type: 'playVideo' }) });
              } else {
                console.log('❌ handleMessage not found');
              }
            })();
            true;
          `;
          webViewRef.current.injectJavaScript(jsCode);
          
          // Update state immediately
          setIsVideoPlaying(true);
          isVideoPlayingRef.current = true;
          setTimerPaused(false);
          timerPausedRef.current = false;
        } else {
          console.log('⏳ WebView not ready yet, will auto-play when ready');
        }
      } else {
        console.log('❌ CANNOT auto-play:', {
          hasCurrentVideo: !!currentVideo,
          hasWebViewRef: !!webViewRef.current,
          suppressAutoPlay: suppressAutoPlayRef.current,
          webViewReady: webViewReady
        });
      }

      return () => {
        console.log('🎯 TAB BLUR: Video tab lost focus');
        isTabFocusedRef.current = false;
        
        // Pause when tab loses focus
        if (webViewRef.current && webViewReady) {
          console.log('⏸️ SENDING pauseVideo message to WebView');
          const jsCode = `
            (function() {
              console.log('🔵 Injected JS executing pauseVideo from tab blur');
              if (typeof window.handleMessage === 'function') {
                console.log('✅ handleMessage found, calling it');
                window.handleMessage({ data: JSON.stringify({ type: 'pauseVideo' }) });
              } else {
                console.log('❌ handleMessage not found');
              }
            })();
            true;
          `;
          webViewRef.current.injectJavaScript(jsCode);
        }
        
        console.log('🔄 UPDATING state: timer paused, video stopped');
        setTimerPaused(true);
        timerPausedRef.current = true;
        setIsVideoPlaying(false);
        isVideoPlayingRef.current = false;
        
        console.log('✅ Blur state updated:', {
          timerPaused: true,
          isVideoPlaying: false
        });
      };
    }, [currentVideo, suppressAutoPlay, webViewReady])
  );

  // Initialize videos
  useEffect(() => {
    if (!user?.id) return;

    const initializeVideos = async () => {
      setIsInitializing(true);
      try {
        await fetchVideos(user.id);
      } catch (error) {
        console.error('Failed to initialize videos:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    if (videoQueue.length === 0) {
      initializeVideos();
    } else {
      setIsInitializing(false);
    }
  }, [user?.id, fetchVideos, videoQueue.length]);

  // Video change handler
  useEffect(() => {
    if (!currentVideo) return;

    const isNewVideo = currentVideoRef.current !== currentVideo.video_id;
    
    if (isNewVideo) {
      // Check if video should be skipped
      if (shouldSkipCurrentVideo()) {
        moveToNextVideo();
        return;
      }

      // Clean up previous video
      cleanupVideo();
      
      // Initialize new video
      initializeNewVideo(currentVideo);
    }
  }, [currentVideo?.video_id, shouldSkipCurrentVideo, moveToNextVideo]);

  // Clean up previous video
  const cleanupVideo = useCallback(() => {
    // Clear timers
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (videoLoadTimeoutRef.current) {
      clearTimeout(videoLoadTimeoutRef.current);
      videoLoadTimeoutRef.current = null;
    }

    // Reset state
    setWatchTimer(0);
    watchTimerRef.current = 0;
    setIsVideoPlaying(false);
    setTimerPaused(false);
    setVideoLoadedSuccessfully(false);
    setVideoError(false);
    setWebViewReady(false);
    rewardProcessedRef.current = false;
  }, []);

  // Initialize new video
  const initializeNewVideo = useCallback((video: any) => {
    if (!video) return;
    
    console.log('🎬 Initializing new video:', video.video_id);
    currentVideoRef.current = video.video_id;
    
    // Reset states for new video
    setIsVideoTransitioning(false);
    setVideoLoadedSuccessfully(false);
    setVideoError(false);
    setWatchTimer(0);
    watchTimerRef.current = 0;
    rewardProcessedRef.current = false;
    setWebViewReady(false);
    
    // Set up video load timeout
    videoLoadTimeoutRef.current = setTimeout(() => {
      if (!videoLoadedRef.current) {
        console.log('⏰ Video load timeout - showing error');
        setVideoError(true);
        setShowRefreshButton(true);
      }
    }, 15000) as any;
  }, []);

  // Timer management
  const startTimer = useCallback(() => {
    if (timerRef.current) return; // Already running

    timerRef.current = setInterval(() => {
      const isPaused = timerPausedRef.current;
      const isLoaded = videoLoadedRef.current;
      const isPlaying = isVideoPlayingRef.current;
      const isFocused = isTabFocusedRef.current;
      
      if (!isPaused && isLoaded && isPlaying && isFocused) {
        watchTimerRef.current += 1;
        setWatchTimer(watchTimerRef.current);
        
        const targetDuration = currentVideo?.duration_seconds || 0;
        
        if (watchTimerRef.current >= targetDuration && !rewardProcessedRef.current) {
          handleVideoCompletion();
        }
      }
    }, 1000);
  }, [currentVideo]);

  // Start video playback
  const startVideoPlayback = useCallback(() => {
    if (!currentVideo || !videoLoadedRef.current) return;

    if (webViewRef.current && webViewReady) {
      const jsCode = `
        (function() {
          console.log('🔵 Injected JS executing playVideo');
          if (typeof window.handleMessage === 'function') {
            console.log('✅ handleMessage found, calling it');
            window.handleMessage({ data: JSON.stringify({ type: 'playVideo' }) });
          } else {
            console.log('❌ handleMessage not found');
          }
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }

    startTimer();
  }, [currentVideo, webViewReady, startTimer]);

  // Handle video completion
  const handleVideoCompletion = useCallback(async () => {
    if (!currentVideo || !user || rewardProcessedRef.current) return;
    
    rewardProcessedRef.current = true;
    setIsProcessingReward(true);
    
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Notify WebView
    if (webViewRef.current && webViewReady) {
      const jsCode = `
        (function() {
          console.log('🔵 Injected JS executing timerComplete');
          if (typeof window.handleMessage === 'function') {
            console.log('✅ handleMessage found, calling it');
            window.handleMessage({ data: JSON.stringify({ type: 'timerComplete' }) });
          } else {
            console.log('❌ handleMessage not found');
          }
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }

    try {
      if (autoSkipEnabledRef.current) {
        await processRewardAndSkip();
      } else {
        // Process reward but don't skip
        const result = await watchVideoAndEarnCoins(user.id, currentVideo.video_id, watchTimerRef.current, true);
        
        if (result.error || !result.data?.success) {
          throw new Error(result.error?.message || 'Failed to process video watch');
        }
        
        // If video was marked as completed, refresh the queue
        if (result.data?.video_completed) {
          console.log('Video marked as completed, refreshing queue');
          await refreshQueue(user.id);
        }
        
        await refreshProfile();
        setIsProcessingReward(false);
      }
    } catch (error) {
      console.error('Error in handleVideoCompletion:', error);
      setIsProcessingReward(false);
    }
  }, [currentVideo, user, refreshProfile]);

  // Process reward and skip to next video
  const processRewardAndSkip = useCallback(async () => {
    if (!currentVideo || !user) return;
    
    setIsProcessingReward(true);
    setIsVideoTransitioning(true);
    
    try {
      const result = await watchVideoAndEarnCoins(user.id, currentVideo.video_id, watchTimerRef.current, true);
      
      if (result.error || !result.data?.success) {
        throw new Error(result.error?.message || 'Failed to process video watch');
      }
      
      // If video was marked as completed, refresh the queue
      if (result.data?.video_completed) {
        console.log('Video marked as completed, refreshing queue');
        await refreshQueue(user.id);
      }
      
      await refreshProfile();
      moveToNextVideo();
      
      // Check if queue needs refresh
      if (videoQueue.length <= 1) {
        await refreshQueue(user.id);
      }
      
    } catch (error) {
      console.error('Error processing reward:', error);
    } finally {
      setIsProcessingReward(false);
      setIsVideoTransitioning(false);
    }
  }, [currentVideo, user, videoQueue.length, refreshProfile, moveToNextVideo, refreshQueue]);

  // Handle skip to next video
  const handleSkipToNext = useCallback(async () => {
    if (autoSkipEnabledRef.current) {
      await processRewardAndSkip();
    } else {
      moveToNextVideo();
    }
    
    if (videoQueue.length === 0 && user) {
      await refreshQueue(user.id);
    }
  }, [processRewardAndSkip, moveToNextVideo, videoQueue.length, refreshQueue, user]);

  // Handle manual skip
  const handleManualSkip = useCallback(() => {
    const targetDuration = currentVideo?.duration_seconds || 0;
    
    if (watchTimer >= targetDuration && !rewardProcessedRef.current) {
      handleVideoCompletion();
    } else {
      // Reset processing state for immediate skip
      setIsProcessingReward(false);
      rewardProcessedRef.current = false;
      moveToNextVideo();
    }
  }, [currentVideo, watchTimer, handleVideoCompletion, moveToNextVideo]);

  // Render WebView - removed as WebView is rendered directly in the component

  // WebView message handler
  const handleWebViewMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('📨 WEBVIEW MESSAGE RECEIVED:', data.type, data);
      
      switch (data.type) {
        case 'webViewReady':
          console.log('🌐 WEBVIEW IS READY - can now send messages safely');
          setWebViewReady(true);
          
          // If tab is focused, auto-play now that WebView is ready
          if (isTabFocusedRef.current && !rewardProcessedRef.current && currentVideo) {
            console.log('🎬 Auto-playing after WebView ready');
            setTimeout(() => {
              if (webViewRef.current) {
                const jsCode = `
                  (function() {
                    console.log('🔵 Injected JS executing playVideo after WebView ready');
                    if (typeof window.handleMessage === 'function') {
                      console.log('✅ handleMessage found, calling it');
                      window.handleMessage({ data: JSON.stringify({ type: 'playVideo' }) });
                    } else {
                      console.log('❌ handleMessage not found');
                    }
                  })();
                  true;
                `;
                webViewRef.current.injectJavaScript(jsCode);
                
                // Update state immediately
                setIsVideoPlaying(true);
                isVideoPlayingRef.current = true;
                setTimerPaused(false);
                timerPausedRef.current = false;
              }
            }, 100);
          }
          break;
          
        case 'videoLoaded':
          console.log('🎬 VIDEO LOADED - updating state');
          setVideoLoadedSuccessfully(true);
          videoLoadedRef.current = true;
          setVideoError(false);
          
          if (videoLoadTimeoutRef.current) {
            clearTimeout(videoLoadTimeoutRef.current);
            videoLoadTimeoutRef.current = null;
          }
          
          // Auto-play immediately when video loads if tab is focused
          console.log('🎬 Checking auto-play on video load:', {
            tabFocused: isTabFocusedRef.current,
            rewardProcessed: rewardProcessedRef.current
          });
          
          if (isTabFocusedRef.current && !rewardProcessedRef.current) {
            console.log('▶️ AUTO-PLAYING video after load');
            if (webViewRef.current) {
              const jsCode = `
                (function() {
                  if (typeof handleMessage === 'function') {
                    handleMessage({ data: JSON.stringify({ type: 'playVideo' }) });
                  }
                })();
              `;
              webViewRef.current.injectJavaScript(jsCode);
            }
            
            // Also start timer and update state immediately for auto-play
            setIsVideoPlaying(true);
            isVideoPlayingRef.current = true;
            setTimerPaused(false);
            timerPausedRef.current = false;
            startTimer();
          } else {
            console.log('❌ NOT auto-playing on load:', {
              tabFocused: isTabFocusedRef.current,
              rewardProcessed: rewardProcessedRef.current
            });
          }
          
          setIsTransitioning(false);
          break;

        case 'videoPlaying':
          console.log('🎉 SUCCESS: VIDEO IS NOW PLAYING - updating React state');
          console.log('📊 WebView confirmed video is playing');
          setIsVideoPlaying(true);
          isVideoPlayingRef.current = true;
          setTimerPaused(false);
          timerPausedRef.current = false;
          setVideoLoadedSuccessfully(true);
          videoLoadedRef.current = true;
          setVideoError(false);
          
          // Reset processing state when video starts playing after completion
          if (rewardProcessedRef.current) {
            setIsProcessingReward(false);
          }
          
          if (isTabFocusedRef.current) {
            startTimer();
          }
          break;
          
        case 'videoPaused':
          console.log('⏸️ VIDEO IS NOW PAUSED - updating React state');
          setIsVideoPlaying(false);
          isVideoPlayingRef.current = false;
          setTimerPaused(true);
          timerPausedRef.current = true;
          break;
          
        case 'videoEnded':
          setVideoError(true);
          if (autoSkipEnabledRef.current) {
            handleSkipToNext();
          }
          break;
          
        case 'videoUnavailable':
        case 'videoError':
          console.log('⚠️ Video unavailable/error - NOT auto-skipping to prevent loop');
          setVideoError(true);
          // Temporarily disable auto-skip for unavailable/error videos
          // if (autoSkipEnabledRef.current) {
          //   setTimeout(() => handleSkipToNext(), 5000);
          // }
          break;
      }
    } catch (error) {
      console.log('❌ WebView message error:', error);
    }
  }, [startTimer, handleSkipToNext, autoSkipEnabledRef]);

  // Create HTML content
  const createHtmlContent = useCallback((youtubeVideoId: string) => {
    // Simple validation - just check if we have a video ID
    if (!youtubeVideoId) {
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
            transition: opacity 0.3s ease;
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
            let timerCompleted = false;
            let playerReady = false;
            let isPlaying = false;
            
            console.log('🌐 WebView JavaScript loaded and ready');
            
            function notifyWebViewReady() {
              try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'webViewReady',
                  timestamp: Date.now()
                }));
                console.log('📡 Sent webViewReady message to React Native');
              } catch (e) {
                console.log('❌ Failed to send webViewReady message:', e);
              }
            }
            
            notifyWebViewReady();
            
            let videoUnavailable = false;
            
            const securityOverlay = document.getElementById('security-overlay');
            const playPauseButton = document.getElementById('play-pause-button');
            const videoContainer = document.getElementById('video-container');
            
            function markVideoUnavailable() {
              if (videoUnavailable) return;
              console.log('🚨 Marking video as unavailable');
              videoUnavailable = true;
              notifyReactNative('videoUnavailable');
            }
            
            function notifyReactNative(type, data = {}) {
              try {
                const message = { type, ...data };
                console.log('📤 Sending to React Native:', message);
                window.ReactNativeWebView.postMessage(JSON.stringify(message));
              } catch (e) {
                console.log('❌ Failed to notify React Native:', e);
              }
            }
            
            function checkIframeAvailability() {
              const iframe = document.getElementById('youtube-player');
              console.log('🔍 Checking iframe availability:', {
                hasIframe: !!iframe,
                iframeSrc: iframe?.src || 'none',
                iframeLoaded: iframe?.contentWindow ? 'yes' : 'no'
              });
              
              if (!iframe) {
                console.log('❌ No iframe found');
                markVideoUnavailable();
                return;
              }
              
              if (!iframe.src) {
                console.log('❌ Iframe has no src');
                markVideoUnavailable();
                return;
              }
              
              console.log('✅ Iframe looks good, setting up error handler');
              iframe.onerror = () => {
                console.log('❌ Iframe onerror triggered');
                markVideoUnavailable();
              };
              
              // Give iframe time to load before checking
              setTimeout(() => {
                if (!videoUnavailable && !playerReady) {
                  console.log('⏰ Iframe load check after 5s - player not ready yet');
                  // Don't mark as unavailable immediately, let YouTube API try to load
                }
              }, 5000);
            }
            
            checkIframeAvailability();
            
            window.handleMessage = function(event) {
              try {
                console.log('📨 WebView received message:', event.data);
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                console.log('📨 Parsed message data:', data);
                
                if (data.type === 'playVideo') {
                  console.log('🎬 WebView received playVideo message');
                  console.log('📊 WebView state:', {
                    playerReady: playerReady,
                    hasPlayer: !!player,
                    timerCompleted: timerCompleted
                  });
                  
                  if (playerReady && player && !timerCompleted) {
                    console.log('✅ All conditions met, calling player.playVideo()');
                    player.playVideo();
                    // Immediately update overlay state
                    updatePlayerState(true);
                    // Notify React Native
                    notifyReactNative('videoPlaying');
                  } else {
                    console.log('❌ Cannot play video - player not ready yet');
                    // Store the play request to execute when player is ready
                    window.pendingPlayRequest = true;
                  }
                }
                
                if (data.type === 'pauseVideo') {
                  console.log('⏸️ WebView received pauseVideo message');
                  if (playerReady && player) {
                    player.pauseVideo();
                    // Immediately update overlay state
                    updatePlayerState(false);
                  }
                }
              } catch (e) {
                console.log('❌ WebView message handling error:', e);
              }
            }
            
            // React Native WebView message handling
            window.addEventListener('message', handleMessage);
            document.addEventListener('message', handleMessage);
            
            // Direct React Native WebView message handler
            if (typeof window !== 'undefined') {
              window.onmessage = handleMessage;
            }
            
            if (!window.YT) {
              console.log('📦 Loading YouTube API script');
              const tag = document.createElement('script');
              tag.src = 'https://www.youtube.com/iframe_api';
              tag.onerror = () => {
                console.log('❌ YouTube API script failed to load');
                markVideoUnavailable();
              };
              tag.onload = () => {
                console.log('✅ YouTube API script loaded');
              };
              
              const firstScriptTag = document.getElementsByTagName('script')[0];
              firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            } else {
              console.log('✅ YouTube API already available');
              window.onYouTubeIframeAPIReady();
            }
            
            window.onYouTubeIframeAPIReady = function() {
              if (videoUnavailable) return;
              
              console.log('🚀 YouTube API ready, initializing player');
              
              try {
                player = new YT.Player('youtube-player', {
                  events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange,
                    'onError': onPlayerError
                  }
                });
                console.log('✅ YouTube player created successfully');
              } catch (e) {
                console.log('❌ Error creating YouTube player:', e);
                markVideoUnavailable();
              }
            };
            
            function onPlayerReady(event) {
              if (videoUnavailable) return;
              
              console.log('🎬 YouTube player ready event triggered');
              playerReady = true;
              
              try {
                const videoData = event.target.getVideoData();
                console.log('📊 Video data:', videoData);
                
                // Be more lenient with video data validation
                if (!videoData) {
                  console.log('❌ No video data available');
                  markVideoUnavailable();
                  return;
                }
                
                // Check if there's a pending play request
                if (window.pendingPlayRequest) {
                  console.log('🎯 Executing pending play request');
                  event.target.playVideo();
                  window.pendingPlayRequest = false;
                  // Update overlay state immediately
                  updatePlayerState(true);
                  notifyReactNative('videoPlaying');
                }
                
                console.log('✅ Video loaded successfully');
                notifyReactNative('videoLoaded');
                
              } catch (e) {
                console.log('❌ Error in onPlayerReady:', e);
                markVideoUnavailable();
              }
            }
            
            function onPlayerStateChange(event) {
              if (event.data === YT.PlayerState.PLAYING) {
                console.log('🎬 YouTube player state: PLAYING');
                updatePlayerState(true);
                notifyReactNative('videoPlaying');
                
                // Execute pending play request if any
                if (window.pendingPlayRequest) {
                  window.pendingPlayRequest = false;
                }
              } else if (event.data === YT.PlayerState.PAUSED) {
                console.log('⏸️ YouTube player state: PAUSED');
                updatePlayerState(false);
                notifyReactNative('videoPaused');
              } else if (event.data === YT.PlayerState.ENDED) {
                console.log('🏁 YouTube player state: ENDED');
                updatePlayerState(false);
                notifyReactNative('videoEnded');
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
              if (!playerReady || !player || timerCompleted || videoUnavailable) return;
              
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
              if (timerCompleted) {
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

  // Extract YouTube video ID from URL
  const extractYouTubeId = useCallback((url: string): string => {
    if (!url) return '';
    
    // If it's already just an ID (11 characters), return it
    if (url.length === 11 && !/[^a-zA-Z0-9_-]/.test(url)) {
      return url;
    }
    
    // Extract from various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return '';
  }, []);

  // Memoize HTML content to prevent unnecessary regeneration
  const htmlContent = useMemo(() => {
    const videoId = extractYouTubeId(currentVideo?.youtube_url || '');
    console.log('🎬 Creating HTML content for video ID:', videoId, 'from URL:', currentVideo?.youtube_url);
    return createHtmlContent(videoId);
  }, [currentVideo?.youtube_url, createHtmlContent, extractYouTubeId]);

  // Handle real-time updates
  useEffect(() => {
    if (videoUpdates?.completed && user) {
      refreshQueue(user.id);
    }
  }, [videoUpdates, user, refreshQueue]);

  // Periodic queue refresh
  useEffect(() => {
    if (!user?.id) return;
    
    const refreshInterval = setInterval(() => {
      if (shouldSkipCurrentVideo()) {
        refreshQueue(user.id);
      }
    }, 120000); // 2 minutes
    
    return () => clearInterval(refreshInterval);
  }, [user?.id, shouldSkipCurrentVideo, refreshQueue]);

  // Utility functions
  const handleOpenYouTube = () => {
    if (currentVideo?.youtube_url) {
      let youtubeUrl = currentVideo.youtube_url;
      
      // If it's just a video ID, construct the full URL
      if (youtubeUrl.length === 11 && !/[^a-zA-Z0-9_-]/.test(youtubeUrl)) {
        youtubeUrl = `https://www.youtube.com/watch?v=${youtubeUrl}`;
      }
      // If it doesn't start with http, assume it needs the full URL
      else if (!youtubeUrl.startsWith('http')) {
        const videoId = extractYouTubeId(youtubeUrl);
        youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      }
      
      Linking.openURL(youtubeUrl).catch(() => {
        Alert.alert('Error', 'Could not open YouTube video');
      });
    }
  };

  const getRemainingTime = () => {
    if (!currentVideo) return 0;
    const targetDuration = currentVideo.duration_seconds || 0;
    return Math.max(0, targetDuration - watchTimer);
  };

  const getButtonState = () => {
    if (isProcessingReward) {
      return { 
        text: 'PROCESSING...', 
        style: styles.processingButton, 
        disabled: true 
      };
    }
    
    const targetDuration = currentVideo?.duration_seconds || 0;
    
    if (watchTimer >= targetDuration) {
      if (rewardProcessedRef.current) {
        return { text: 'COINS EARNED! TAP TO CONTINUE', style: styles.earnedButton, disabled: false };
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
      text: 'SKIP VIDEO', 
      style: styles.skipButton, 
      disabled: false 
    };
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupVideo();
    };
  }, [cleanupVideo]);

  // Early return for unauthenticated users
  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.text }]}>Redirecting to login...</Text>
      </View>
    );
  }

  // Loading state
  if (isLoading || isInitializing) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <GlobalHeader 
          title="View" 
          showCoinDisplay={true}
          menuVisible={menuVisible} 
          setMenuVisible={setMenuVisible} 
        />
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.text }]}>
            {isInitializing ? 'Loading videos...' : 'Loading...'}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => user && fetchVideos(user.id)}><Text style={styles.retryButtonText}>Retry</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  // No video available state
  if (!currentVideo) {
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
            onPress={() => user && fetchVideos(user.id)}><Text style={styles.refreshButtonText}>Refresh</Text></TouchableOpacity>
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
          source={{ html: htmlContent }}
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
          cacheEnabled={true}
          cacheMode="LOAD_DEFAULT"
          onError={() => {
            setVideoError(true);
            if (autoSkipEnabledRef.current) {
              handleSkipToNext();
            }
          }}
          onHttpError={() => {
            setVideoError(true);
            if (autoSkipEnabledRef.current) {
              handleSkipToNext();
            }
          }}
          key={`video-${currentVideo?.video_id || 'default'}`}
          startInLoadingState={false}
          renderLoading={() => <></>}
        />
      </View>

      {currentVideo?.title ? (
        <Text
          style={[styles.videoTitleText, { color: colors.text }]}
          numberOfLines={3}
          allowFontScaling={false}
        >
          {String(currentVideo.title).trim()}
        </Text>
      ) : null}

      <View style={[styles.controlsContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.youtubeButtonContainer, { backgroundColor: colors.surface }]}>
          <ExternalLink size={20} color="#FF0000" />
          <TouchableOpacity onPress={handleOpenYouTube} style={styles.youtubeTextButton}><Text style={[styles.youtubeButtonText, { color: colors.text }]}>Open on YouTube</Text></TouchableOpacity>
          <View style={styles.autoPlayContainer}>
            <Text style={[styles.autoPlayText, { color: colors.textSecondary }]}>Auto Skip</Text>
            <TouchableOpacity
              style={[styles.toggle, { backgroundColor: colors.border }]}
              onPress={() => setAutoSkipEnabled(!autoSkipEnabled)}><View style={[
                styles.toggleSlider,
                autoSkipEnabled && [styles.toggleActive, { backgroundColor: colors.success }]
              ]} /></TouchableOpacity>
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
          disabled={buttonState.disabled}><Text style={styles.skipButtonText}>{buttonState.text}</Text></TouchableOpacity>
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
  videoTitleText: {
    marginTop: 6,
    marginBottom: 6,
    marginHorizontal: 16,
    fontSize: isTinyScreen ? 16 : isSmallScreen ? 18 : isTablet ? 20 : 18,
    fontWeight: '700',
    lineHeight: isTinyScreen ? 22 : isSmallScreen ? 24 : isTablet ? 26 : 24,
    textAlign: 'center',
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
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
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
    // Color applied dynamically
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
});
