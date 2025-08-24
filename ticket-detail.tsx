import React, { useState, useEffect, useRef } from 'react';
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
  RefreshControl,
  FlatList,
  Alert,
  Animated
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  Send, 
  Paperclip, 
  X, 
  ArrowLeft, 
  Shield, 
  User as UserIcon,
  FileText,
  Image as ImageIcon,
  Download,
  Check,
  RefreshCw,
  AlertCircle,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle
} from 'lucide-react-native';
import { getSupabase } from '@/lib/supabase';
import { useCustomAlert } from '@/hooks/useCustomAlert';
import CustomAlert from '@/components/CustomAlert';
import * as DocumentPicker from 'expo-document-picker';
import FileUploadService from '@/services/FileUploadService';

const { width: screenWidth } = Dimensions.get('window');
const isSmallScreen = screenWidth < 380;

function TicketDetailScreen() {
  const { profile, user } = useAuth();
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const supabase = getSupabase();
  const { showError, showSuccess, showInfo, alertProps, showAlert } = useCustomAlert();
  const scrollViewRef = useRef(null);

  // State
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [realtimeSubscription, setRealtimeSubscription] = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Load ticket data
  useEffect(() => {
    if (params.id) {
      loadTicketData();
      setupRealtimeSubscription();
      
      // Animate on mount
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }

    return () => {
      if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
      }
    };
  }, [params.id]);

  const setupRealtimeSubscription = () => {
    if (!params.id || !user?.id) return;

    const subscription = supabase
      .channel(`ticket_${params.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'support_tickets',
          filter: `id=eq.${params.id}`
        },
        (payload) => {
          console.log('Ticket updated:', payload);
          loadTicketData();
        }
      )
      .subscribe();

    setRealtimeSubscription(subscription);
  };

  const loadTicketData = async () => {
    if (!params.id) return;

    setLoading(true);
    try {
      // Load ticket
      const { data: ticketData, error: ticketError } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('id', params.id)
        .single();

      if (ticketError) throw ticketError;
      setTicket(ticketData);

      // Load conversation
      const { data: conversationData, error: conversationError } = await supabase
        .rpc('get_ticket_conversation', { p_ticket_id: params.id });

      if (conversationError) throw conversationError;
      
      // Format messages
      const formattedMessages = conversationData || [];
      
      // Add initial message
      if (ticketData) {
        formattedMessages.unshift({
          id: 'initial',
          user_id: ticketData.reported_by,
          message: ticketData.description,
          is_admin: false,
          created_at: ticketData.created_at,
          attachments: ticketData.attachments || []
        });
      }

      setMessages(formattedMessages);
      
      // Mark as read
      if (ticketData && !ticketData.is_read) {
        await supabase
          .from('support_tickets')
          .update({ is_read: true })
          .eq('id', params.id);
      }

      // Scroll to bottom
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

    } catch (error) {
      console.error('Error loading ticket:', error);
      showError('Error', 'Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTicketData();
    setRefreshing(false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && attachments.length === 0) return;
    if (!user?.id || !params.id) return;

    setSending(true);
    try {
      // Upload attachments if any
      let attachmentData = [];
      if (attachments.length > 0) {
        try {
          // Ensure storage bucket exists
          await FileUploadService.ensureBucketExists();
          
          // Upload files to ticket folder
          const uploadedFiles = await FileUploadService.uploadMultipleFiles(
            attachments,
            params.id as string,
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
          showError('Upload Failed', 'Failed to upload attachments. Please try again.');
          setSending(false);
          return;
        }
      }

      // Add message
      const { data, error } = await supabase.rpc('add_ticket_message', {
        p_ticket_id: params.id,
        p_user_id: user.id,
        p_message: newMessage.trim(),
        p_is_admin: false,
        p_attachments: attachmentData
      });

      if (error) throw error;

      // Clear input
      setNewMessage('');
      setAttachments([]);

      // Reload conversation
      await loadTicketData();

      showSuccess('Message Sent', 'Your message has been sent successfully');

    } catch (error) {
      console.error('Error sending message:', error);
      showError('Error', 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handlePickDocument = async () => {
    if (attachments.length >= 3) {
      showError('Limit Reached', 'You can only attach up to 3 files per message');
      return;
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
          showError('File Too Large', 'File size must be less than 5MB');
          return;
        }

        setAttachments([...attachments, {
          name: file.name,
          size: file.size,
          uri: file.uri,
          mimeType: file.mimeType || 'application/octet-stream'
        }]);
      }
    } catch (error) {
      console.error('Document picker error:', error);
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

  const getStatusIcon = (status) => {
    switch(status) {
      case 'active': return <AlertCircle size={20} color="#3498DB" />;
      case 'pending': return <Clock size={20} color="#F39C12" />;
      case 'answered': return <MessageSquare size={20} color="#800080" />;
      case 'completed': return <CheckCircle size={20} color="#27AE60" />;
      case 'closed': return <XCircle size={20} color="#95A5A6" />;
      default: return <AlertCircle size={20} color="#95A5A6" />;
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'active': return '#3498DB';
      case 'pending': return '#F39C12';
      case 'answered': return '#800080';
      case 'completed': return '#27AE60';
      case 'closed': return '#95A5A6';
      default: return '#95A5A6';
    }
  };

  const renderMessage = ({ item, index }) => {
    const isAdmin = item.is_admin;
    const isCurrentUser = !isAdmin;  // User message when NOT admin
    const messageTime = new Date(item.created_at);
    const timeString = messageTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'You';

    return (
      <Animated.View 
        style={[
          styles.messageWrapper,
          isCurrentUser ? styles.userMessageWrapper : styles.adminMessageWrapper,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        {/* Avatar for admin messages - LEFT SIDE */}
        {isAdmin && (
          <View style={[
            styles.avatar, 
            { 
              backgroundColor: '#075E54',
              marginRight: 8
            }
          ]}>
            <Shield size={18} color="white" />
          </View>
        )}
        
        <View style={styles.messageContent}>
          {/* Sender name label */}
          <Text style={{
            fontSize: 12,
            color: isAdmin ? '#075E54' : '#128C7E',
            fontWeight: '600',
            marginBottom: 4,
            marginLeft: isAdmin ? 12 : 0,
            marginRight: isCurrentUser ? 12 : 0,
            textAlign: isCurrentUser ? 'right' : 'left'
          }}>
            {isAdmin ? 'Admin' : userName}
          </Text>
          
          {/* Message bubble with tail */}
          <View style={[
            styles.messageBubble,
            isCurrentUser ? styles.userBubble : styles.adminBubble,
            { 
              backgroundColor: isCurrentUser 
                ? '#DCF8C6'
                : '#FFFFFF',
              maxWidth: screenWidth * 0.75,
              borderWidth: isAdmin ? 1 : 0,
              borderColor: isAdmin ? '#E5E5E5' : 'transparent'
            }
          ]}>
            {/* Tail for message bubble */}
            <View style={[
              styles.messageTail,
              isCurrentUser ? styles.userTail : styles.adminTail,
              {
                backgroundColor: isCurrentUser 
                  ? '#DCF8C6'
                  : '#FFFFFF',
                borderLeftWidth: isAdmin ? 1 : 0,
                borderTopWidth: isAdmin ? 1 : 0,
                borderColor: isAdmin ? '#E5E5E5' : 'transparent'
              }
            ]} />
            
            {/* Message text */}
            <Text style={[
              styles.messageText, 
              { 
                color: '#303030',
                fontSize: 15,
                lineHeight: 20
              }
            ]}>
              {item.message}
            </Text>

            {/* Attachments */}
            {item.attachments && item.attachments.length > 0 && (
              <View style={styles.messageAttachments}>
                {item.attachments.map((attachment: any, idx: number) => (
                  <TouchableOpacity 
                    key={idx} 
                    style={[
                      styles.attachmentChip,
                      { 
                        backgroundColor: isCurrentUser 
                          ? 'rgba(0,0,0,0.05)' 
                          : 'rgba(0,0,0,0.03)',
                        borderWidth: 1,
                        borderColor: 'rgba(0,0,0,0.1)'
                      }
                    ]}
                    onPress={async () => {
                      if (attachment.url) {
                        const downloadUrl = await FileUploadService.getDownloadUrl(attachment.path);
                        if (downloadUrl) {
                          showInfo('Opening File', `Opening ${attachment.name}...`);
                        }
                      }
                    }}
                  >
                    {attachment.type?.includes('image') ? (
                      <ImageIcon size={14} color="#128C7E" />
                    ) : (
                      <FileText size={14} color="#128C7E" />
                    )}
                    <Text 
                      style={[
                        styles.attachmentName, 
                        { 
                          color: '#4A5568'
                        }
                      ]} 
                      numberOfLines={1}
                    >
                      {attachment.name}
                    </Text>
                    <Download size={12} color="#128C7E" />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Time and status */}
            <View style={styles.messageFooter}>
              <Text style={[
                styles.messageTime, 
                { 
                  color: '#8696A0',
                  fontSize: 11
                }
              ]}>
                {timeString}
              </Text>
              {isCurrentUser && (
                <Text style={{
                  fontSize: 11,
                  color: item.sent === false ? '#FF6B6B' : '#4CAF50',
                  marginLeft: 6,
                  fontStyle: 'italic'
                }}>
                  {item.sent === false ? 'Not sent' : 'Sent'}
                </Text>
              )}
            </View>
          </View>
        </View>
        
        {/* Avatar for user messages - RIGHT SIDE */}
        {isCurrentUser && (
          <View style={[
            styles.avatar, 
            { 
              backgroundColor: '#128C7E',
              marginLeft: 8
            }
          ]}>
            <Text style={{ color: 'white', fontSize: 14, fontWeight: 'bold' }}>
              {userName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={isDark ? [colors.headerBackground, colors.surface] : ['#800080', '#800080']}
          style={styles.gradientHeader}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ArrowLeft size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Loading...</Text>
            <View style={{ width: 40 }} />
          </View>
        </LinearGradient>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>
          Ticket not found
        </Text>
      </View>
    );
  }

  const isTicketClosed = ticket.status === 'closed' || ticket.status === 'completed';

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient
        colors={isDark ? [colors.headerBackground, colors.surface] : ['#800080', '#800080']}
        style={styles.gradientHeader}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              #{ticket.id.slice(0, 8)}
            </Text>
            <View style={[
              styles.statusBadge, 
              { backgroundColor: getStatusColor(ticket.status) + '30' }
            ]}>
              {getStatusIcon(ticket.status)}
              <Text style={[styles.statusText, { color: getStatusColor(ticket.status) }]}>
                {ticket.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <TouchableOpacity 
            style={styles.refreshButton}
            onPress={onRefresh}
          >
            <RefreshCw size={20} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Ticket Info */}
      <View style={[styles.ticketInfo, { backgroundColor: colors.surface }]}>
        <Text style={[styles.ticketTitle, { color: colors.text }]}>
          {ticket.title}
        </Text>
        <View style={styles.ticketMeta}>
          <Text style={[styles.ticketMetaText, { color: colors.textSecondary }]}>
            Category: {ticket.category}
          </Text>
          <Text style={[styles.ticketMetaText, { color: colors.textSecondary }]}>
            Priority: {ticket.priority}
          </Text>
        </View>
      </View>

      {/* Chat Background */}
      <View style={[styles.chatBackground, { backgroundColor: isDark ? '#1A202C' : '#E5DDD5' }]}>
        {/* Messages */}
        <FlatList
          ref={scrollViewRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id || Math.random().toString()}
          contentContainerStyle={styles.messagesContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      </View>

      {/* Input Area */}
      {!isTicketClosed && (
        <View style={[
          styles.inputArea, 
          { 
            backgroundColor: isDark ? '#2D3748' : '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: isDark ? '#4A5568' : '#E2E8F0',
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.1,
                shadowRadius: 3,
              },
              android: {
                elevation: 8,
              },
            }),
          }
        ]}>
          {attachments.length > 0 && (
            <ScrollView 
              horizontal 
              style={styles.attachmentsPreview}
              showsHorizontalScrollIndicator={false}
            >
              {attachments.map((attachment, index) => (
                <View key={index} style={[
                  styles.attachmentPreview, 
                  { 
                    backgroundColor: isDark ? '#4A5568' : '#F7FAFC',
                    borderColor: isDark ? '#718096' : '#CBD5E0'
                  }
                ]}>
                  <FileText size={14} color={colors.primary} />
                  <Text style={[styles.attachmentPreviewName, { color: colors.text }]} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  <TouchableOpacity 
                    onPress={() => removeAttachment(index)}
                    style={styles.removeAttachment}
                  >
                    <XCircle size={18} color={isDark ? '#F56565' : '#E53E3E'} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
          
          <View style={styles.inputRow}>
            <TouchableOpacity 
              style={[
                styles.attachButton,
                { 
                  backgroundColor: isDark ? '#4A5568' : '#EDF2F7',
                  opacity: attachments.length >= 3 ? 0.5 : 1
                }
              ]}
              onPress={handlePickDocument}
              disabled={attachments.length >= 3}
            >
              <Paperclip 
                size={22} 
                color={attachments.length >= 3 
                  ? (isDark ? '#718096' : '#A0AEC0') 
                  : (isDark ? '#4A90E2' : '#800080')
                } 
              />
            </TouchableOpacity>
            
            <View style={[
              styles.messageInputContainer,
              { 
                backgroundColor: isDark ? '#1A202C' : '#F7FAFC',
                borderColor: isDark ? '#4A5568' : '#E2E8F0'
              }
            ]}>
              <TextInput
                style={[styles.messageInput, { color: colors.text }]}
                placeholder="Type a message"
                placeholderTextColor={isDark ? '#718096' : '#A0AEC0'}
                value={newMessage}
                onChangeText={setNewMessage}
                multiline
                maxLength={500}
              />
            </View>
            
            <TouchableOpacity 
              style={[
                styles.sendButton, 
                { 
                  backgroundColor: (!newMessage.trim() && attachments.length === 0) || sending 
                    ? (isDark ? '#4A5568' : '#CBD5E0')
                    : (isDark ? '#4A90E2' : '#800080'),
                  transform: [{ rotate: '-45deg' }]
                }
              ]}
              onPress={handleSendMessage}
              disabled={(!newMessage.trim() && attachments.length === 0) || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Send size={22} color="white" style={{ transform: [{ rotate: '45deg' }] }} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Closed Ticket Notice */}
      {isTicketClosed && (
        <View style={[styles.closedNotice, { backgroundColor: colors.surface }]}>
          <CheckCircle size={20} color={getStatusColor(ticket.status)} />
          <Text style={[styles.closedNoticeText, { color: colors.text }]}>
            This ticket has been {ticket.status}
          </Text>
        </View>
      )}

      <CustomAlert {...alertProps} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientHeader: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 16 : 50,
    paddingBottom: 14,
    paddingHorizontal: 20,
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
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  refreshButton: {
    padding: 8,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50,
  },
  ticketInfo: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  ticketTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  ticketMeta: {
    flexDirection: 'row',
    gap: 16,
  },
  ticketMetaText: {
    fontSize: 13,
  },
  chatBackground: {
    flex: 1,
  },
  messagesContainer: {
    padding: 16,
    paddingBottom: 20,
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  adminMessageWrapper: {
    justifyContent: 'flex-start',
  },
  userMessageWrapper: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  messageContent: {
    maxWidth: '75%',
    position: 'relative',
  },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    position: 'relative',
    minWidth: 80,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  userBubble: {
    borderTopRightRadius: 4,
    marginRight: 8,
  },
  adminBubble: {
    borderTopLeftRadius: 4,
    marginLeft: 8,
  },
  messageTail: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 15,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  userTail: {
    right: -8,
    top: 0,
    borderBottomColor: 'inherit',
    transform: [{ rotate: '45deg' }],
  },
  adminTail: {
    left: -8,
    top: 0,
    borderBottomColor: 'inherit',
    transform: [{ rotate: '-45deg' }],
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  messageAttachments: {
    marginTop: 10,
    gap: 6,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
  },
  attachmentName: {
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    justifyContent: 'flex-end',
  },
  messageTime: {
    fontSize: 11,
    fontWeight: '400',
  },
  inputArea: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 25 : 10,
  },
  attachmentsPreview: {
    maxHeight: 45,
    marginBottom: 10,
  },
  attachmentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    marginRight: 8,
    gap: 8,
    borderWidth: 1,
  },
  attachmentPreviewName: {
    fontSize: 13,
    maxWidth: 120,
    fontWeight: '500',
  },
  removeAttachment: {
    padding: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageInputContainer: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    minHeight: 44,
    maxHeight: 120,
    justifyContent: 'center',
  },
  messageInput: {
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    minHeight: 44,
    maxHeight: 100,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  closedNoticeText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default TicketDetailScreen;
