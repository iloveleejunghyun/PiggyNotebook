<template>
  <view class="page">
    <view class="list-area">
      <view v-if="topics.length === 0" class="empty">
        <text class="empty-title">还没有主题</text>
        <text class="empty-sub">在下面按住说话，或点键盘输入，记下第一个想法</text>
      </view>

      <view v-else class="list">
        <view
          v-for="topic in topics"
          :key="topic.id"
          class="card"
          @click="openTopic(topic.id)"
        >
          <view class="card-header">
            <text class="card-title">{{ topic.title }}</text>
            <text class="card-count">{{ topic.fragments.length }}条</text>
          </view>
          <text class="card-summary">{{ topic.summary || '暂无汇总' }}</text>
          <text class="card-time">{{ formatTime(topic.updatedAt) }}</text>
        </view>
      </view>
    </view>

    <!-- always-docked capture bar — no extra tap needed to start recording/typing -->
    <view class="capture-bar">
      <view v-if="inputMode === 'text'" class="text-mode-bar">
        <input
          v-model="text"
          class="bar-input"
          placeholder="随手记下一个想法…"
          confirm-type="send"
          @confirm="onNext"
        />
        <view class="bar-icon-btn" @click="inputMode = 'voice'">
          <text>🎤</text>
        </view>
        <view class="bar-send-btn" :class="{ disabled: !text.trim() || loading }" @click="onNext">
          <text>{{ loading ? '…' : '发送' }}</text>
        </view>
      </view>

      <view v-else class="voice-mode-bar">
        <view class="hold-to-talk-btn" @click="onVoiceTap">
          <text>按住说话</text>
        </view>
        <view class="bar-icon-btn" @click="inputMode = 'text'">
          <text>⌨️</text>
        </view>
      </view>
    </view>

    <!-- review overlay — AI quick-accept (if available) + pick existing + create new -->
    <view v-if="stage === 'review'" class="overlay" @click.self="closeReview">
      <view class="review-sheet">
        <text v-if="manualNotice" class="notice-text">{{ manualNotice }}</text>

        <view v-if="suggestion" class="suggested-topic-card" @click="quickAcceptSuggestion">
          <text class="confirm-label">{{ suggestion.isNewTopic ? 'AI 建议新建主题（点击使用）' : 'AI 建议归入（点击使用）' }}</text>
          <text class="suggested-title">{{ suggestion.suggestedTitle }}</text>
        </view>

        <text class="section-label">选择已有主题</text>
        <view v-if="pickableTopics.length === 0" class="empty-hint">
          <text>还没有其他主题</text>
        </view>
        <view v-else class="topic-pick-list">
          <view
            v-for="t in pickableTopics"
            :key="t.id"
            class="topic-pick-item"
            @click="saveTo(t.id)"
          >
            <text>{{ t.title }}</text>
          </view>
        </view>

        <text class="section-label new-topic-label">或新建主题</text>
        <input
          v-model="newTopicTitle"
          class="new-topic-input"
          placeholder="新主题名称"
          maxlength="40"
        />
        <view class="primary-btn" :class="{ disabled: !newTopicTitle.trim() }" @click="saveToNew">
          <text>新建并保存</text>
        </view>
        <view class="cancel-btn" @click="closeReview">
          <text>取消</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getTopics, createTopic, addFragment, updateTopicSummary } from '@/utils/storage.js'
import { suggestTopic, summarizeTopic, AIServiceUnavailableError } from '@/services/ai.js'

export default {
  data() {
    return {
      topics: [],
      text: '',
      loading: false,
      stage: 'input', // 'input' | 'review'
      inputMode: 'text', // 'text' | 'voice' — defaults to text since voice recording isn't wired up yet
      suggestion: null,
      manualNotice: '',
      newTopicTitle: ''
    }
  },
  computed: {
    // in the review sheet, don't re-list the topic AI already suggested as a quick-accept card
    pickableTopics() {
      if (!this.suggestion || this.suggestion.isNewTopic) return this.topics
      return this.topics.filter(t => t.id !== this.suggestion.topicId)
    }
  },
  onShow() {
    // re-read on every show so a summary refreshed on the detail page is reflected
    this.topics = getTopics()
  },
  methods: {
    openTopic(topicId) {
      uni.navigateTo({ url: `/pages/topic-detail/topic-detail?id=${topicId}` })
    },
    onVoiceTap() {
      // Voice capture isn't implemented yet — say so honestly instead of
      // pretending to record. Swap this out once real recording + ASR lands.
      uni.showToast({ title: '语音输入即将上线，先用文字试试吧', icon: 'none' })
    },
    async onNext() {
      if (!this.text.trim() || this.loading) return
      this.loading = true
      try {
        const result = await suggestTopic(
          this.text.trim(),
          this.topics.map(t => ({ id: t.id, title: t.title }))
        )
        this.suggestion = result
        // Pre-fill the "create new" field only when AI is proposing a *new*
        // topic — prefilling it with an existing topic's title would be
        // confusing (that's not what "new topic" means here).
        this.newTopicTitle = result.isNewTopic ? result.suggestedTitle : ''
      } catch (e) {
        // Honest fallback: don't fake a suggestion, let the user decide manually.
        console.error('suggestTopic failed:', e.message)
        this.suggestion = null
        this.newTopicTitle = ''
        this.manualNotice = e instanceof AIServiceUnavailableError
          ? 'AI 建议服务暂不可用，请手动选择或新建主题'
          : '出错了，请手动选择或新建主题'
      } finally {
        this.loading = false
        this.stage = 'review'
      }
    },
    quickAcceptSuggestion() {
      if (this.suggestion.isNewTopic) {
        const topic = createTopic(this.suggestion.suggestedTitle)
        this.saveTo(topic.id)
      } else {
        this.saveTo(this.suggestion.topicId)
      }
    },
    saveToNew() {
      if (!this.newTopicTitle.trim()) return
      const topic = createTopic(this.newTopicTitle.trim())
      this.saveTo(topic.id)
    },
    saveTo(topicId) {
      addFragment(topicId, { text: this.text.trim(), source: 'text' })
      this.refreshSummaryBestEffort(topicId)
      this.topics = getTopics()
      uni.showToast({ title: '已保存', icon: 'success' })
      this.closeReview()
    },
    closeReview() {
      this.stage = 'input'
      this.text = ''
      this.suggestion = null
      this.manualNotice = ''
      this.newTopicTitle = ''
    },
    async refreshSummaryBestEffort(topicId) {
      // Fire-and-forget: fragment is already saved regardless of whether
      // the summary regenerates successfully. Never blocks the save flow.
      try {
        const topic = getTopics().find(t => t.id === topicId)
        if (!topic) return
        const summary = await summarizeTopic(topic)
        updateTopicSummary(topicId, summary)
        this.topics = getTopics()
      } catch (e) {
        console.warn('Summary refresh skipped:', e.message)
      }
    },
    formatTime(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.list-area {
  flex: 1;
  padding: 24rpx;
  padding-bottom: 160rpx; /* leave room for the docked capture bar */
  box-sizing: border-box;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 240rpx;
}
.empty-title {
  font-size: 32rpx;
  color: #333;
  margin-bottom: 12rpx;
}
.empty-sub {
  font-size: 26rpx;
  color: #999;
  text-align: center;
  padding: 0 60rpx;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}
.card-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #222;
}
.card-count {
  font-size: 24rpx;
  color: #F97316;
}
.card-summary {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 12rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-time {
  font-size: 22rpx;
  color: #bbb;
}

/* docked capture bar */
.capture-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  padding: 16rpx 24rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -2rpx 12rpx rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
}
.text-mode-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.bar-input {
  flex: 1;
  background: #F5F5F5;
  border-radius: 36rpx;
  padding: 16rpx 28rpx;
  font-size: 28rpx;
  height: 40rpx;
}
.bar-icon-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #F5F5F5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  flex-shrink: 0;
}
.bar-send-btn {
  padding: 0 28rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: #F97316;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.bar-send-btn.disabled {
  opacity: 0.4;
}
.voice-mode-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.hold-to-talk-btn {
  flex: 1;
  height: 72rpx;
  border-radius: 36rpx;
  background: #F97316;
  color: #fff;
  font-size: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* review overlay */
.overlay {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  z-index: 10;
}
.review-sheet {
  width: 100%;
  background: #F5F5F5;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx 24rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  max-height: 80vh;
  overflow-y: auto;
}
.confirm-label {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 12rpx;
}
.suggested-topic-card {
  background: #fff;
  border: 2rpx solid #F97316;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
  text-align: center;
}
.suggested-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #222;
}
.notice-text {
  display: block;
  font-size: 24rpx;
  color: #DD524D;
  margin-bottom: 20rpx;
}
.section-label {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 12rpx;
}
.new-topic-label {
  margin-top: 32rpx;
}
.empty-hint {
  color: #bbb;
  font-size: 26rpx;
  margin-bottom: 20rpx;
}
.topic-pick-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.topic-pick-item {
  background: #fff;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  color: #333;
}
.new-topic-input {
  background: #fff;
  border-radius: 12rpx;
  padding: 20rpx;
  font-size: 28rpx;
  margin-bottom: 20rpx;
  box-sizing: border-box;
}
.primary-btn {
  text-align: center;
  padding: 24rpx;
  border-radius: 16rpx;
  background: #F97316;
  color: #fff;
  font-size: 30rpx;
}
.primary-btn.disabled {
  opacity: 0.4;
}
.cancel-btn {
  text-align: center;
  padding: 20rpx;
  margin-top: 12rpx;
  color: #999;
  font-size: 26rpx;
}
</style>
