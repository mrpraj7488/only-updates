import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Animated,
  Clipboard,
  RefreshControl,
  Alert
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  ArrowLeft, 
  MessageCircle, 
  Send, 
  Phone, 
  Mail, 
  HelpCircle,
  AlertCircle,
  CreditCard,
  User,
  Video,
  Coins,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Star,
  Copy,
  Paperclip,
  X,
  FileText,
  Image,
  RefreshCw,
  MessageSquare,
  Check,
  History,
  ChevronRight,
  ArrowRight
} from 'lucide-react-native';
import { getSupabase } from '@/lib/supabase';
import { useCustomAlert } from '@/hooks/useCustomAlert';
import CustomAlert from '@/components/CustomAlert';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import FileUploadService from '@/services/FileUploadService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isSmallScreen = screenWidth < 380;
const isTinyScreen = screenWidth < 350;

function ContactSupportScreen() {
  const { profile, user } = useAuth();
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const supabase = getSupabase();
  const { showError, showInfo, alertProps, showAlert } = useCustomAlert();
  
  // State
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('medium');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentTickets, setRecentTickets] = useState([]);
  const [showRecentTickets, setShowRecentTickets] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [copiedTicketId, setCopiedTicketId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [realtimeSubscription, setRealtimeSubscription] = useState(null);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const refreshRotation = useRef(new Animated.Value(0)).current;
  const spinValue = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  const supportCategories = [
    { 
      id: 'technical', 
      title: 'Technical Issue', 
      icon: AlertCircle,
      color: '#FF6B6B',
      description: 'App crashes, bugs, errors'
    },
    { 
      id: 'payment', 
      title: 'Payment', 
      icon: CreditCard,
      color: '#4ECDC4',
      description: 'Billing and transactions'
    },
    { 
      id: 'account', 
      title: 'Account', 
      icon: User,
      color: '#45B7D1',
      description: 'Login, profile, settings'
    },
    { 
      id: 'video', 
      title: 'Videos', 
      icon: Video,
      color: '#96CEB4',
      description: 'Promotion errors'
    },
    { 
      id: 'coins', 
      title: 'Coins', 
      icon: Coins,
      color: '#FFEAA7',
      description: 'Rewards and earnings'
    },
    { 
      id: 'other', 
      title: 'Other', 
      icon: MoreHorizontal,
      color: '#DDA0DD',
      description: 'General inquiries'
    },
  ];

  const priorityLevels = [
    { 
      id: 'low', 
      title: 'Low', 
      desc: 'General questions',
      color: '#10B981',
      bgColor: isDark ? '#1A4736' : '#ECFDF5'
    },
    { 
      id: 'medium', 
      title: 'Medium', 
      desc: 'Account issues',
      color: '#F59E0B',
      bgColor: isDark ? '#4A3A1A' : '#FFFBEB'
    },
    { 
      id: 'high', 
      title: 'High', 
      desc: 'Technical problems',
      color: '#EF4444',
      bgColor: isDark ? '#4A1A1A' : '#FEF2F2'
    }
  ];

  // Setup real-time subscription
  useEffect(() => {
    if (!user?.id) return;

    const subscription = supabase
      .channel('support_tickets_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_tickets',
          filter: `reported_by=eq.${user.id}`
        },
        (payload) => {
          console.log('Ticket update:', payload);
          loadRecentTickets();
        }
      )
      .subscribe();

    setRealtimeSubscription(subscription);

    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [user?.id]);

  // Load recent tickets
  useEffect(() => {
    loadRecentTickets();
    
    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        delay: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const loadRecentTickets = async () => {
    if (!user?.id) {
      console.log('No user ID available');
      return;
    }
    
    setLoadingTickets(true);
    try {
      console.log('Fetching recent tickets for user:', user.id);
      
      // First, try to fetch a single ticket to check if the table exists
      const { data, error, status } = await supabase
        .from('support_tickets')
        .select('id')
        .eq('reported_by', user.id)
        .limit(1);
      
      // If we get a 404, the table doesn't exist
      if (status === 406 || (error && error.code === '42P01')) {
        console.log('Support tickets table does not exist or is not accessible');
        setRecentTickets([]);
        return;
      }
      
      // Now fetch the actual tickets we want to display
      const { data: tickets, error: fetchError } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('reported_by', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      console.log('Tickets fetch status:', status);
      
      if (fetchError) {
        console.error('Supabase error:', fetchError);
        // Don't throw here, just show an empty state
        setRecentTickets([]);
        return;
      }
      
      console.log('Fetched tickets:', tickets);
      setRecentTickets(tickets || []);
      
      // If no tickets, show a helpful message
      if (!tickets || tickets.length === 0) {
        console.log('No tickets found for user');
      }
    } catch (error: any) {
      console.error('Error loading tickets:', error);
      setRecentTickets([]);
      // Only show error if it's not a 404 (table doesn't exist)
      if (error.code !== '42P01') { // 42P01 is the code for "relation does not exist"
        showError('Error', 'Failed to load recent tickets. Please check your connection and try again.');
      }
    } finally {
      setLoadingTickets(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    
    // Animate refresh icon
    Animated.loop(
      Animated.timing(refreshRotation, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      })
    ).start();

    await loadRecentTickets();
    
    setTimeout(() => {
      setRefreshing(false);
      refreshRotation.setValue(0);
    }, 500);
  }, []);

  const handlePickDocument = async () => {
    if (attachments.length >= 5) {
      return; // Silently prevent adding more files
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf', 'text/*'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const file = result.assets[0];
        
        // Check file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
          return; // Silently reject large files
        }

        // Add to attachments
        setAttachments([...attachments, {
          name: file.name,
          size: file.size,
          uri: file.uri,
          mimeType: file.mimeType || 'application/octet-stream'
        }]);
      }
    } catch (error) {
      console.error('Document picker error:', error);
      // Silently handle error
    }
  };

  const removeAttachment = (index) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleSubmitTicket = async () => {
    if (!selectedCategory || !subject || !message) {
      return; // Form validation handled by UI state
    }

    if (!user?.id) {
      return; // Auth handled elsewhere
    }

    setLoading(true);
    
    try {
      // Upload attachments if any
      let attachmentData = [];
      if (attachments.length > 0) {
        try {
          // Ensure storage bucket exists
          await FileUploadService.ensureBucketExists();
          
          // Generate temporary ticket ID for file organization
          const tempTicketId = `temp_${Date.now()}`;
          
          // Upload files
          const uploadedFiles = await FileUploadService.uploadMultipleFiles(
            attachments,
            tempTicketId,
            user.id
          );
          
          // Format attachment data with URLs
          attachmentData = uploadedFiles.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type,
            url: file.url,
            path: file.path,
            uploaded_at: new Date().toISOString()
          }));
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          setLoading(false);
          return;
        }
      }

      const { data, error } = await supabase
        .from('support_tickets')
        .insert({
          title: subject,
          description: message,
          status: 'active',
          priority: selectedPriority,
          category: selectedCategory,
          reported_by: user.id,
          attachments: attachmentData
        })
        .select()
        .single();

      if (error) throw error;

      // Move uploaded files to correct ticket folder if needed
      if (attachments.length > 0 && data?.id) {
        // Files are already uploaded with correct structure
        console.log('Ticket created with attachments:', data.id);
      }

      // Reset form and reload tickets seamlessly
      setSubject('');
      setMessage('');
      setSelectedCategory('');
      setSelectedPriority('medium');
      setAttachments([]);
      loadRecentTickets();
      
      // Navigate to ticket detail automatically
      router.push(`/ticket-detail?id=${data.id}`);
      
    } catch (error) {
      console.error('Submit error:', error);
      // Only show error for critical failures
      showError('Error', 'Failed to submit ticket. Please try again.');
    } finally {
      setLoading(false);
      setUploadingFile(false);
    }
  };

  const getStatusIcon = (status) => {
    switch(status) {
      case 'active': return <AlertCircle size={16} color="#3498DB" />;
      case 'pending': return <Clock size={16} color="#F39C12" />;
      case 'answered': return <MessageSquare size={16} color="#800080" />;
      case 'completed': return <CheckCircle size={16} color="#27AE60" />;
      case 'closed': return <XCircle size={16} color="#95A5A6" />;
      default: return <HelpCircle size={16} color="#95A5A6" />;
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'active': { bg: isDark ? '#2A4365' : '#EBF8FF', text: '#2563EB' },
      'pending': { bg: isDark ? '#4C2C17' : '#FEF3C7', text: '#D97706' },
      'answered': { bg: isDark ? '#1A4736' : '#D1FAE5', text: '#059669' },
      'completed': { bg: isDark ? '#3C2F5F' : '#F3E8FF', text: '#7C3AED' },
      'closed': { bg: isDark ? '#2D3748' : '#F3F4F6', text: '#6B7280' }
    };
    return colors[status] || colors.active;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'low': '#10B981',
      'medium': '#F59E0B',
      'high': '#EF4444'
    };
    return colors[priority] || colors.low;
  };

  const formatRelativeTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  };

  const copyTicketId = (ticketId) => {
    Clipboard.setString(ticketId.toString());
    setCopiedTicketId(ticketId);
    setTimeout(() => {
      setCopiedTicketId(null);
    }, 2000);
  };

  const navigateToTicketDetail = (ticket) => {
    router.push(`/ticket-detail?id=${ticket.id}`);
  };

  const handleManualRefresh = async () => {
    Animated.timing(refreshRotation, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start(() => {
      refreshRotation.setValue(0);
    });
    
    await loadRecentTickets();
    // Seamless refresh without popup
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    gradientHeader: {
      paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 16 : 50,
      paddingBottom: 14,
      paddingHorizontal: 20,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
        },
        android: {
          elevation: 8,
        },
      }),
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 44,
    },
    backButton: {
      padding: 6,
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 20,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 0.5,
    },
    content: {
      flex: 1,
      padding: isSmallScreen ? 16 : 20,
    },
    subtitle: {
      fontSize: isSmallScreen ? 14 : 16,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 22,
      color: isDark ? '#A0AEC0' : '#4A5568',
      fontWeight: '400',
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: isSmallScreen ? 16 : 18,
      fontWeight: '600',
      marginBottom: 12,
      color: isDark ? '#E2E8F0' : '#2D3748',
    },
    categoriesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: isSmallScreen ? 10 : 12,
    },
    categoryCard: {
      width: isSmallScreen ? '47%' : '48%',
      padding: isSmallScreen ? 14 : 18,
      borderRadius: isSmallScreen ? 12 : 16,
      alignItems: 'center',
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
        },
        android: {
          elevation: 6,
        },
      }),
    },
    categoryIcon: {
      width: isSmallScreen ? 44 : 48,
      height: isSmallScreen ? 44 : 48,
      borderRadius: isSmallScreen ? 22 : 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
        },
        android: {
          elevation: 3,
        },
      }),
    },
    categoryTitle: {
      fontSize: isSmallScreen ? 14 : 15,
      fontWeight: '700',
      marginBottom: 6,
      letterSpacing: 0.3,
      textAlign: 'center',
    },
    categoryDesc: {
      fontSize: isSmallScreen ? 11 : 12,
      textAlign: 'center',
      lineHeight: isSmallScreen ? 14 : 16,
      fontWeight: '500',
    },
    priorityContainer: {
      flexDirection: 'row',
      gap: isSmallScreen ? 8 : 12,
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
    priorityButton: {
      flex: 1,
      minWidth: isTinyScreen ? 90 : 100,
      padding: isSmallScreen ? 14 : 16,
      borderRadius: isSmallScreen ? 12 : 16,
      alignItems: 'center',
      borderWidth: 2,
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.3 : 0.1,
          shadowRadius: 8,
        },
        android: {
          elevation: 6,
        },
      }),
    },
    priorityButtonSelected: {
      transform: [{ scale: 1.02 }],
      borderWidth: 2,
    },
    priorityText: {
      fontSize: isSmallScreen ? 14 : 15,
      fontWeight: '700',
      marginBottom: 6,
      letterSpacing: 0.3,
    },
    priorityDesc: {
      fontSize: isSmallScreen ? 11 : 12,
      color: isDark ? '#A0AEC0' : '#718096',
      textAlign: 'center',
      fontWeight: '500',
      lineHeight: isSmallScreen ? 14 : 16,
    },
    inputContainer: {
      borderRadius: 14,
      borderWidth: 1,
      backgroundColor: isDark ? '#2D3748' : '#F7FAFC',
      borderColor: isDark ? '#4A5568' : '#E2E8F0',
      marginBottom: 8,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.2 : 0.05,
      shadowRadius: 3,
      elevation: 2,
    },
    input: {
      paddingHorizontal: 16,
      paddingVertical: isSmallScreen ? 12 : 14,
      fontSize: isSmallScreen ? 14 : 16,
      color: isDark ? '#E2E8F0' : '#2D3748',
    },
    messageContainer: {
      minHeight: 160,
      paddingBottom: 8,
    },
    messageInput: {
      paddingTop: 14,
      minHeight: 140,
      textAlignVertical: 'top',
    },
    messageBoxFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 8,
      paddingHorizontal: 4,
    },
    attachmentIconButton: {
      position: 'relative',
      padding: 8,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.2)' : 'rgba(128, 0, 128, 0.1)',
    },
    attachmentBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      backgroundColor: isDark ? '#4A90E2' : '#800080',
      borderRadius: 10,
      minWidth: 16,
      height: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    attachmentBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    compactAttachmentsList: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    },
    compactAttachmentItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
      paddingHorizontal: 8,
      marginBottom: 4,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.1)' : 'rgba(128, 0, 128, 0.05)',
      borderRadius: 8,
    },
    compactAttachmentName: {
      flex: 1,
      fontSize: 12,
      color: isDark ? '#E2E8F0' : '#2D3748',
      fontWeight: '500',
    },
    compactRemoveButton: {
      padding: 4,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    },
    charCount: {
      fontSize: 12,
      color: isDark ? '#A0AEC0' : '#718096',
      fontWeight: '500',
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: isSmallScreen ? 16 : 18,
      borderRadius: isSmallScreen ? 14 : 16,
      gap: 10,
      marginBottom: 24,
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
        },
        android: {
          elevation: 8,
        },
      }),
    },
    submitButtonText: {
      color: '#FFFFFF',
      fontSize: isSmallScreen ? 15 : 16,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    recentTicketsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 8,
      marginBottom: 16,
    },
    recentTicketsTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    recentTicketsTitleText: {
      fontSize: isSmallScreen ? 17 : 19,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    refreshButton: {
      padding: 8,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.2)' : 'rgba(128, 0, 128, 0.1)',
    },
    ticketsContainer: {
      gap: isSmallScreen ? 12 : 16,
    },
    ticketCard: {
      backgroundColor: isDark ? '#2D3748' : '#FFFFFF',
      borderRadius: isSmallScreen ? 14 : 18,
      padding: isSmallScreen ? 18 : 22,
      marginBottom: isSmallScreen ? 14 : 18,
      borderWidth: 1,
      borderColor: isDark ? '#4A5568' : '#E2E8F0',
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.4 : 0.12,
          shadowRadius: 12,
        },
        android: {
          elevation: 8,
        },
      }),
    },
    ticketCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12,
    },
    ticketIdSection: {
      flex: 1,
    },
    ticketIdContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    ticketIdLabel: {
      fontSize: isSmallScreen ? 11 : 12,
      fontWeight: '500',
      opacity: 0.7,
      letterSpacing: 0.5,
      color: isDark ? '#A0AEC0' : '#718096',
    },
    copyButton: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.1)' : 'rgba(128, 0, 128, 0.05)',
    },
    statusPriorityContainer: {
      alignItems: 'flex-end',
      gap: 8,
    },
    statusBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    },
    statusText: {
      fontSize: isSmallScreen ? 10 : 11,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    priorityIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: isDark ? '#2D3748' : '#FFFFFF',
    },
    ticketTitle: {
      fontSize: isSmallScreen ? 15 : 16,
      fontWeight: '600',
      lineHeight: isSmallScreen ? 20 : 22,
      marginBottom: 8,
      color: isDark ? '#E2E8F0' : '#2D3748',
    },
    ticketDescription: {
      fontSize: isSmallScreen ? 13 : 14,
      lineHeight: isSmallScreen ? 18 : 20,
      marginBottom: 16,
      opacity: 0.8,
      color: isDark ? '#A0AEC0' : '#718096',
    },
    ticketFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
    },
    ticketMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    categoryBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.1)' : 'rgba(128, 0, 128, 0.05)',
    },
    categoryText: {
      fontSize: isSmallScreen ? 10 : 11,
      fontWeight: '500',
      color: isDark ? '#4A90E2' : '#800080',
      textTransform: 'capitalize',
    },
    ticketDate: {
      fontSize: isSmallScreen ? 11 : 12,
      fontWeight: '500',
      color: isDark ? '#A0AEC0' : '#718096',
    },
    viewButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.1)' : 'rgba(128, 0, 128, 0.05)',
    },
    viewButtonText: {
      fontSize: isSmallScreen ? 11 : 12,
      fontWeight: '600',
      color: isDark ? '#4A90E2' : '#800080',
    },
    viewAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: isSmallScreen ? 14 : 16,
      borderRadius: 12,
      gap: 8,
      marginTop: 8,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: isDark ? '#4A5568' : '#E2E8F0',
      backgroundColor: isDark ? '#2D3748' : '#F7FAFC',
    },
    viewAllText: {
      fontSize: isSmallScreen ? 14 : 15,
      fontWeight: '600',
      color: isDark ? '#4A90E2' : '#800080',
    },
    emptyTicketsContainer: {
      alignItems: 'center',
      padding: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: isDark ? '#4A5568' : '#E2E8F0',
      backgroundColor: isDark ? '#2D3748' : '#F7FAFC',
    },
    emptyTicketsText: {
      fontSize: isSmallScreen ? 14 : 15,
      textAlign: 'center',
      marginTop: 12,
      color: isDark ? '#A0AEC0' : '#718096',
    },
    contactCard: {
      padding: isSmallScreen ? 18 : 22,
      borderRadius: isSmallScreen ? 14 : 18,
      marginBottom: 24,
      backgroundColor: isDark ? '#2D3748' : '#F7FAFC',
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.4 : 0.12,
          shadowRadius: 12,
        },
        android: {
          elevation: 8,
        },
      }),
    },
    contactHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 20,
    },
    contactTitle: {
      fontSize: isSmallScreen ? 16 : 18,
      fontWeight: '700',
      color: isDark ? '#E2E8F0' : '#2D3748',
    },
    contactItems: {
      gap: 16,
      alignItems: 'center',
    },
    contactItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingVertical: 8,
      width: '100%',
      backgroundColor: isDark ? 'rgba(74, 144, 226, 0.1)' : 'rgba(128, 0, 128, 0.05)',
      borderRadius: 10,
    },
    contactText: {
      fontSize: isSmallScreen ? 14 : 15,
      color: isDark ? '#A0AEC0' : '#4A5568',
      fontWeight: '500',
    },
    responseTimeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    },
    responseTime: {
      fontSize: isSmallScreen ? 12 : 13,
      color: isDark ? '#A0AEC0' : '#718096',
      fontWeight: '500',
    },
    viewTicketButton: {
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF',
      borderColor: isDark ? '#4A5568' : '#E2E8F0',
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.3 : 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    viewTicketText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#4A90E2' : '#800080',
    },
  });

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient
        colors={isDark ? ['#1E293B', '#334155'] : ['#800080', '#800080']}
        style={styles.gradientHeader}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contact Support</Text>
          <View style={{ width: 24 }} />
        </View>
      </LinearGradient>

      <ScrollView 
        style={[styles.content, { backgroundColor: isDark ? colors.background : '#F7FAFC' }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            tintColor={isDark ? '#4A90E2' : '#800080'}
            title="Refreshing..."
            titleColor={isDark ? '#A0AEC0' : '#718096'}
          />
        }
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            We're here to help! Select a category and describe your issue.
          </Text>
        </Animated.View>

        {/* Category Selection */}
        <Animated.View 
          style={[
            styles.section,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }]
            }
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Select Category <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <View style={styles.categoriesGrid}>
            {supportCategories.map((category, index) => {
              const IconComponent = category.icon;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    styles.categoryCard,
                    { 
                      backgroundColor: selectedCategory === category.id 
                        ? category.color + '20' 
                        : isDark ? '#2D3748' : '#FFFFFF',
                      borderColor: selectedCategory === category.id 
                        ? category.color 
                        : isDark ? '#4A5568' : '#E2E8F0',
                      borderWidth: selectedCategory === category.id ? 2 : 1,
                    }
                  ]}
                  onPress={() => setSelectedCategory(category.id)}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={[category.color + '20', category.color + '10']}
                    style={styles.categoryIcon}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <IconComponent size={isSmallScreen ? 22 : 24} color={category.color} />
                  </LinearGradient>
                  <Text style={[
                    styles.categoryTitle,
                    { 
                      color: selectedCategory === category.id 
                        ? category.color 
                        : isDark ? '#E2E8F0' : '#2D3748',
                      fontWeight: selectedCategory === category.id ? '700' : '600'
                    }
                  ]}>
                    {category.title}
                  </Text>
                  <Text style={[styles.categoryDesc, { color: isDark ? '#A0AEC0' : '#718096' }]}>
                    {category.description}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>

        {/* Priority Selection */}
        <Animated.View 
          style={[
            styles.section,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Priority Level <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <View style={styles.priorityContainer}>
            {priorityLevels.map((priority) => (
              <TouchableOpacity
                key={priority.id}
                style={[
                  styles.priorityButton,
                  selectedPriority === priority.id && styles.priorityButtonSelected,
                  {
                    backgroundColor: isDark ? '#2D3748' : '#FFFFFF',
                    borderColor: selectedPriority === priority.id 
                      ? priority.color 
                      : isDark ? '#4A5568' : '#E2E8F0',
                  }
                ]}
                onPress={() => setSelectedPriority(priority.id)}
                activeOpacity={0.7}
              >
                {selectedPriority === priority.id && (
                  <LinearGradient
                    colors={[priority.bgColor, priority.bgColor + '80']}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                )}
                <Text style={[
                  styles.priorityText,
                  { 
                    color: selectedPriority === priority.id 
                      ? priority.color 
                      : isDark ? '#E2E8F0' : '#2D3748',
                    fontWeight: selectedPriority === priority.id ? '700' : '600'
                  }
                ]}>
                  {priority.title}
                </Text>
                <Text style={styles.priorityDesc}>
                  {priority.desc}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>

        {/* Subject Input */}
        <Animated.View 
          style={[
            styles.section,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
              marginTop: 8,
            }
          ]}
        >
          <Text style={[
            styles.sectionTitle, 
            { 
              color: colors.text,
              marginBottom: 10,
              fontSize: 15,
              fontWeight: '600',
            }
          ]}>
            Subject <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <View style={[
            styles.inputContainer,
            {
              backgroundColor: isDark ? '#2D3748' : '#FFFFFF',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isDark ? '#4A5568' : '#E2E8F0',
              shadowColor: isDark ? '#000' : '#4A90E2',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: isDark ? 0.15 : 0.1,
              shadowRadius: 4,
              elevation: 3,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }
          ]}>
            <TextInput
              style={[
                styles.input, 
                { 
                  color: colors.text,
                  fontSize: 15,
                  padding: 0,
                  minHeight: 24,
                  flex: 1,
                }
              ]}
              placeholder="Brief description of your issue"
              placeholderTextColor={isDark ? '#718096' : '#A0AEC0'}
              value={subject}
              onChangeText={setSubject}
              maxLength={100}
              selectionColor={isDark ? '#4A90E2' : '#800080'}
            />
            <Text style={[
              styles.charCount,
              {
                color: isDark ? '#A0AEC0' : '#718096',
                fontSize: 12,
                marginTop: 4,
                alignSelf: 'flex-end',
              }
            ]}>
              {subject.length}/100
            </Text>
          </View>
        </Animated.View>

        {/* Message Input */}
        <Animated.View 
          style={[
            styles.section,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Detailed Message <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <View style={[styles.inputContainer, styles.messageContainer]}>
            <TextInput
              style={[styles.input, styles.messageInput, { color: colors.text }]}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={isDark ? '#A0AEC0' : '#A0AEC0'}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={1000}
            />
            
            {/* Attachment Button Inside Message Box */}
            <View style={styles.messageBoxFooter}>
              <TouchableOpacity 
                style={[styles.attachmentIconButton, {
                  opacity: attachments.length >= 5 ? 0.5 : 1,
                }]}
                onPress={handlePickDocument}
                disabled={uploadingFile || attachments.length >= 5}
              >
                {uploadingFile ? (
                  <ActivityIndicator size="small" color={isDark ? '#4A90E2' : '#800080'} />
                ) : (
                  <Paperclip size={18} color={isDark ? '#4A90E2' : '#800080'} />
                )}
                {attachments.length > 0 && (
                  <View style={styles.attachmentBadge}>
                    <Text style={styles.attachmentBadgeText}>{attachments.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
              
              <Text style={styles.charCount}>
                {message.length}/1000
              </Text>
            </View>
            
            {/* Compact Attachment List */}
            {attachments.length > 0 && (
              <View style={styles.compactAttachmentsList}>
                {attachments.map((attachment, index) => (
                  <View key={attachment.name} style={styles.compactAttachmentItem}>
                    <Text style={styles.compactAttachmentName} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <TouchableOpacity 
                      style={styles.compactRemoveButton}
                      onPress={() => removeAttachment(index)}
                    >
                      <X size={12} color={isDark ? '#E53E3E' : '#C53030'} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Animated.View>


        {/* Submit Button */}
        <TouchableOpacity
          onPress={handleSubmitTicket}
          disabled={loading || !selectedCategory || !subject || !message}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={loading || !selectedCategory || !subject || !message 
              ? ['#A0AEC0', '#718096'] 
              : isDark ? ['#4A90E2', '#6366F1'] : ['#800080', '#800080']}
            style={styles.submitButton}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Send size={20} color="#FFFFFF" />
            )}
            <Text style={styles.submitButtonText}>
              {loading ? 'Submitting...' : 'Submit Ticket'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Recent Tickets */}
        <Animated.View 
          style={[
            styles.section,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <View style={styles.recentTicketsHeader}>
            <View style={styles.recentTicketsTitle}>
              <History size={22} color={isDark ? '#4A90E2' : '#800080'} />
              <Text style={[styles.recentTicketsTitleText, { color: colors.text }]}>
                Recent Tickets
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.refreshButton}
              onPress={handleManualRefresh} 
              disabled={refreshing}
            >
              <Animated.View style={{ transform: [{ rotate: spinValue }] }}>
                <RefreshCw size={16} color={isDark ? '#4A90E2' : '#800080'} />
              </Animated.View>
            </TouchableOpacity>
          </View>
          
          {recentTickets.length > 0 ? (
            <View style={styles.ticketsContainer}>
              {recentTickets.slice(0, 3).map((ticket) => (
                <TouchableOpacity
                  key={ticket.id}
                  style={styles.ticketCard}
                  onPress={() => navigateToTicketDetail(ticket)}
                  activeOpacity={0.8}
                >
                  <View style={styles.ticketCardHeader}>
                    <View style={styles.ticketIdSection}>
                      <View style={styles.ticketIdContainer}>
                        <Text style={styles.ticketIdLabel}>
                          TICKET #{ticket.id.slice(-6).toUpperCase()}
                        </Text>
                        <TouchableOpacity 
                          style={styles.copyButton}
                          onPress={() => copyTicketId(ticket.id)}
                        >
                          {copiedTicketId === ticket.id ? (
                            <Check size={12} color={isDark ? '#4A90E2' : '#800080'} />
                          ) : (
                            <Copy size={12} color={isDark ? '#4A90E2' : '#800080'} />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                    
                    <View style={styles.statusPriorityContainer}>
                      <View style={[styles.statusBadge, { 
                        backgroundColor: getStatusColor(ticket.status).bg,
                        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                      }]}>
                        {getStatusIcon(ticket.status)}
                        <Text style={[styles.statusText, { 
                          color: getStatusColor(ticket.status).text 
                        }]}>
                          {ticket.status}
                        </Text>
                      </View>
                      <View style={[styles.priorityIndicator, { 
                        backgroundColor: getPriorityColor(ticket.priority),
                        shadowColor: getPriorityColor(ticket.priority),
                      }]} />
                    </View>
                  </View>
                  
                  <Text style={styles.ticketTitle} numberOfLines={2}>
                    {ticket.title}
                  </Text>
                  
                  {ticket.description && (
                    <Text style={styles.ticketDescription} numberOfLines={2}>
                      {ticket.description}
                    </Text>
                  )}
                  
                  <View style={styles.ticketFooter}>
                    <View style={styles.ticketMeta}>
                      <View style={

styles.categoryBadge}>
                        <Text style={styles.categoryText}>
                          {ticket.category}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} color={isDark ? '#A0AEC0' : '#718096'} />
                        <Text style={styles.ticketDate}>
                          {formatRelativeTime(ticket.created_at)}
                        </Text>
                      </View>
                    </View>
                    
                    <TouchableOpacity 
                      style={styles.viewButton}
                      onPress={() => navigateToTicketDetail(ticket)}
                    >
                      <Text style={styles.viewButtonText}>View</Text>
                      <ChevronRight size={14} color={isDark ? '#4A90E2' : '#800080'} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
              
              {recentTickets.length > 3 && (
                <TouchableOpacity 
                  style={styles.viewAllButton}
                  onPress={() => {/* Navigate to all tickets */}}
                >
                  <MessageSquare size={18} color={isDark ? '#4A90E2' : '#800080'} />
                  <Text style={styles.viewAllText}>
                    View All {recentTickets.length} Tickets
                  </Text>
                  <ArrowRight size={16} color={isDark ? '#4A90E2' : '#800080'} />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.emptyTicketsContainer}>
              <MessageCircle size={32} color={isDark ? '#A0AEC0' : '#718096'} style={{ opacity: 0.5 }} />
              <Text style={styles.emptyTicketsText}>
                No support tickets yet.{"\n"}Submit your first ticket above to get started!
              </Text>
            </View>
          )}
        </Animated.View>
        
        {/* Contact Info */}
        <View style={styles.contactCard}>
          <View style={styles.contactHeader}>
            <Star size={20} color="#FFD700" />
            <Text style={styles.contactTitle}>
              Quick Support
            </Text>
          </View>
          
          <View style={styles.contactItems}>
            <View style={styles.contactItem}>
              <Mail size={18} color={isDark ? '#4A90E2' : '#800080'} />
              <Text style={styles.contactText}>
                support@vidgro.com
              </Text>
            </View>
            
            <View style={styles.contactItem}>
              <Phone size={18} color={isDark ? '#4A90E2' : '#800080'} />
              <Text style={styles.contactText}>
                +1 (555) 123-4567
              </Text>
            </View>
          </View>
          
          <View style={styles.responseTimeContainer}>
            <Clock size={14} color={isDark ? '#A0AEC0' : '#718096'} />
            <Text style={styles.responseTime}>
              Average response: 2-4 hours
            </Text>
          </View>
        </View>
      </ScrollView>
      
      <CustomAlert {...alertProps} />
    </KeyboardAvoidingView>
  );
}

export default ContactSupportScreen;
