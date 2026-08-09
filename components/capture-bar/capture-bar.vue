<template>
  <view>
    <!-- always-docked capture bar — no extra tap needed to start recording/typing -->
    <view class="capture-bar">
      <text v-if="selectedTopic" class="selected-label">当前主题：{{ selectedTopic.title }}</text>
      <text v-else class="selected-label muted">未选择主题，AI 会帮你判断归到哪个主题</text>

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
        <view
          class="hold-to-talk-btn"
          :class="{ recording: recordingState === 'recording', busy: recordingState === 'starting' || recordingState === 'transcribing' }"
          @touchstart.stop.prevent="onRecordStart"
          @touchend.stop.prevent="onRecordEnd"
          @touchcancel.stop.prevent="onRecordCancel"
        >
          <text>{{ recordButtonLabel }}</text>
        </view>
        <view class="bar-icon-btn" @click="inputMode = 'text'">
          <text>⌨️</text>
        </view>
      </view>
    </view>

    <!-- review overlay — AI quick-accept (if any) + pick existing + create new -->
    <view v-if="stage === 'review'" class="overlay" @click.self="closeReview">
      <view class="review-sheet">
        <text v-if="manualNotice" class="notice-text">{{ manualNotice }}</text>

        <view v-if="mismatchTopicId" class="keep-current-card" @click="keepCurrentTopic">
          <text>仍然保存到当前主题「{{ currentTopicTitleAtMismatch }}」</text>
        </view>

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
import {
  getTopics,
  getSelectedTopicId,
  setSelectedTopicId,
  createTopic,
  addFragment,
  updateTopicSummary,
  setFragmentAnswer
} from '@/utils/storage.js'
import { suggestTopic, checkTopicFit, summarizeTopic, answerIfNeeded, AIServiceUnavailableError } from '@/services/ai.js'
import { recognizeAudio } from '@/services/asr.js'

// Below this, a released hold is almost certainly an accidental tap, not
// real speech — discard rather than sending near-empty audio to the API.
const MIN_RECORDING_MS = 500

export default {
  data() {
    return {
      topics: [],
      selectedTopicId: null,
      text: '',
      loading: false,
      stage: 'input', // 'input' | 'review'
      inputMode: 'text', // 'text' | 'voice'
      recordingState: 'idle', // 'idle' | 'starting' | 'recording' | 'transcribing'
      // touchend fired while we were still waiting for the recorder to
      // actually confirm it started (common on iOS Simulator, where audio
      // session init can take a couple seconds) — stop as soon as it does
      pendingStop: false,
      suggestion: null,
      manualNotice: '',
      newTopicTitle: '',
      // set only when the review sheet was triggered by a selected-topic
      // mismatch (as opposed to the "no topic selected yet" full-suggest path)
      mismatchTopicId: null,
      currentTopicTitleAtMismatch: ''
    }
  },
  computed: {
    selectedTopic() {
      return this.topics.find(t => t.id === this.selectedTopicId) || null
    },
    recordButtonLabel() {
      if (this.recordingState === 'starting') return '连接中…'
      if (this.recordingState === 'recording') return '松开 发送'
      if (this.recordingState === 'transcribing') return '识别中…'
      return '按住说话'
    },
    pickableTopics() {
      const excludeIds = new Set()
      if (this.suggestion && !this.suggestion.isNewTopic && this.suggestion.topicId) {
        excludeIds.add(this.suggestion.topicId)
      }
      if (this.mismatchTopicId) excludeIds.add(this.mismatchTopicId)
      return this.topics.filter(t => !excludeIds.has(t.id))
    }
  },
  mounted() {
    this.refresh()
    this.setupRecorder()
  },
  methods: {
    /**
     * Re-reads topics + the pinned selected-topic from storage. Call this
     * from the host page's onShow (via $refs) whenever the page becomes
     * visible again, since this component has no page-level lifecycle of
     * its own.
     */
    refresh() {
      this.topics = getTopics()
      let sel = getSelectedTopicId()
      if (!sel || !this.topics.find(t => t.id === sel)) {
        sel = this.topics.length ? this.topics[0].id : null
        setSelectedTopicId(sel)
      }
      this.selectedTopicId = sel
    },
    setupRecorder() {
      // Created once and reused — uni.getRecorderManager() is a singleton
      // per app anyway, but keeping our own reference makes intent explicit.
      this.recorderManager = uni.getRecorderManager()
      this.recorderManager.onStart(() => this.handleRecordStarted())
      this.recorderManager.onStop(res => this.handleRecordStop(res))
      this.recorderManager.onError(err => this.handleRecordError(err))
    },
    onRecordStart() {
      if (this.recordingState !== 'idle' || !this.recorderManager) return
      // 'starting' is a real, distinct state — the native recorder hasn't
      // confirmed it's actually rolling yet (audio session init can take a
      // couple seconds, especially on iOS Simulator). We don't claim
      // "recording" until handleRecordStarted actually fires.
      this.recordingState = 'starting'
      this.pendingStop = false
      try {
        this.recorderManager.start({
          format: 'aac',
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          duration: 60000 // hard cap — matches typical short-audio ASR limits
        })
      } catch (e) {
        console.error('Recorder start failed:', e)
        this.recordingState = 'idle'
        uni.showToast({ title: '录音启动失败', icon: 'none' })
      }
    },
    handleRecordStarted() {
      if (this.recordingState !== 'starting') return
      this.recordingState = 'recording'
      // user already released before the native recorder caught up —
      // honor that now instead of leaving it stuck "recording"
      if (this.pendingStop) {
        this.pendingStop = false
        this.recorderManager.stop()
      }
    },
    onRecordEnd() {
      if (this.recordingState === 'starting') {
        this.pendingStop = true
        return
      }
      if (this.recordingState !== 'recording') return
      // stop() is async — recordingState flips to 'transcribing' once
      // handleRecordStop actually has a file to work with.
      this.recorderManager.stop()
    },
    onRecordCancel() {
      // Touch got interrupted (e.g. an OS gesture stole it) — still stop
      // cleanly so the recorder isn't left running in the background.
      if (this.recordingState === 'starting') {
        this.pendingStop = true
        return
      }
      if (this.recordingState === 'recording') this.recorderManager.stop()
    },
    async handleRecordStop(res) {
      if (!res || !res.tempFilePath) {
        this.recordingState = 'idle'
        return
      }
      if (res.duration < MIN_RECORDING_MS) {
        this.recordingState = 'idle'
        uni.showToast({ title: '说话时间太短了', icon: 'none' })
        return
      }
      this.recordingState = 'transcribing'
      try {
        const transcribed = await recognizeAudio(res.tempFilePath)
        if (!transcribed) {
          uni.showToast({ title: '没听清，再说一次吧', icon: 'none' })
          return
        }
        // Feed straight into the same pipeline typed text uses — voice is
        // just an alternate input method, not a separate flow.
        this.text = transcribed
        await this.onNext()
      } catch (e) {
        console.error('ASR failed:', e.message)
        uni.showToast({ title: '语音识别暂不可用', icon: 'none' })
      } finally {
        this.recordingState = 'idle'
      }
    },
    handleRecordError(err) {
      console.error('Recorder error:', err)
      this.recordingState = 'idle'
      uni.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
    },
    async onNext() {
      if (!this.text.trim() || this.loading) return
      this.loading = true
      try {
        if (this.selectedTopic) {
          await this.captureWithSelectedTopic()
        } else {
          await this.captureWithFullSuggest()
        }
      } finally {
        this.loading = false
      }
    },
    // Fast path: a topic is already selected, so just check it still fits
    // and save straight to it — only interrupt the user when the AI is
    // confident this fragment belongs somewhere else.
    async captureWithSelectedTopic() {
      const topic = this.selectedTopic
      const otherTopics = this.topics
        .filter(t => t.id !== topic.id)
        .map(t => ({ id: t.id, title: t.title }))
      try {
        const result = await checkTopicFit(this.text.trim(), { title: topic.title }, otherTopics)
        if (result.fits) {
          this.saveTo(topic.id)
          return
        }
        this.suggestion = { topicId: result.topicId, suggestedTitle: result.suggestedTitle, isNewTopic: result.isNewTopic }
        this.newTopicTitle = result.isNewTopic ? result.suggestedTitle : ''
        this.mismatchTopicId = topic.id
        this.currentTopicTitleAtMismatch = topic.title
        this.manualNotice = `这条内容好像跟当前主题不太一样，要切换吗？`
        this.stage = 'review'
      } catch (e) {
        // Non-critical background check — fail open rather than blocking
        // the save on it. We're not faking a "fits" verdict, we're just
        // skipping the extra check and trusting the user's own selection.
        console.warn('Topic fit check skipped, saving directly:', e.message)
        this.saveTo(topic.id)
      }
    },
    // Slow path: no topic selected yet (e.g. very first fragment ever) —
    // fall back to full AI classification across all topics.
    async captureWithFullSuggest() {
      try {
        const result = await suggestTopic(
          this.text.trim(),
          this.topics.map(t => ({ id: t.id, title: t.title }))
        )
        this.suggestion = result
        this.newTopicTitle = result.isNewTopic ? result.suggestedTitle : ''
        this.manualNotice = ''
      } catch (e) {
        console.error('suggestTopic failed:', e.message)
        this.suggestion = null
        this.newTopicTitle = ''
        this.manualNotice = e instanceof AIServiceUnavailableError
          ? 'AI 建议服务暂不可用，请手动选择或新建主题'
          : '出错了，请手动选择或新建主题'
      } finally {
        this.mismatchTopicId = null
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
    keepCurrentTopic() {
      this.saveTo(this.mismatchTopicId)
    },
    saveToNew() {
      if (!this.newTopicTitle.trim()) return
      const topic = createTopic(this.newTopicTitle.trim())
      this.saveTo(topic.id)
    },
    saveTo(topicId) {
      const fragmentText = this.text.trim()
      const fragment = addFragment(topicId, { text: fragmentText, source: 'text' })
      setSelectedTopicId(topicId)
      this.selectedTopicId = topicId
      this.topics = getTopics()
      this.refreshSummaryBestEffort(topicId)
      if (fragment) this.maybeAnswerBestEffort(topicId, fragment.id, fragmentText)
      uni.showToast({ title: '已保存', icon: 'success' })
      this.closeReview()
      // 'saved' fires once, right now, so the host page can jump to the
      // topic and show where the fragment landed. 'changed' fires again
      // later when the background summary refresh finishes — that one's
      // just a data refresh, not a navigation trigger.
      this.$emit('saved', topicId)
    },
    closeReview() {
      this.stage = 'input'
      this.text = ''
      this.suggestion = null
      this.manualNotice = ''
      this.newTopicTitle = ''
      this.mismatchTopicId = null
      this.currentTopicTitleAtMismatch = ''
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
        this.$emit('changed')
      } catch (e) {
        console.warn('Summary refresh skipped:', e.message)
      }
    },
    async maybeAnswerBestEffort(topicId, fragmentId, fragmentText) {
      // Fire-and-forget, single-shot: no follow-up thread, no blocking the
      // save. Silent no-op unless the AI is confident it should answer.
      // Attaches to the original fragment (not a new one) so the question
      // and answer render together as one Q&A card.
      try {
        const topic = getTopics().find(t => t.id === topicId)
        if (!topic) return
        const result = await answerIfNeeded(fragmentText, { title: topic.title, summary: topic.summary })
        if (!result.needsAnswer) return
        setFragmentAnswer(topicId, fragmentId, result.answer)
        this.topics = getTopics()
        this.$emit('changed')
      } catch (e) {
        console.warn('AI answer skipped:', e.message)
      }
    }
  }
}
</script>

<style scoped>
.capture-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  padding: 12rpx 24rpx;
  padding-bottom: calc(12rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -2rpx 12rpx rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
  z-index: 5;
}
.selected-label {
  display: block;
  font-size: 22rpx;
  color: #F97316;
  margin-bottom: 8rpx;
}
.selected-label.muted {
  color: #999;
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
.hold-to-talk-btn.recording {
  background: #DD524D;
}
.hold-to-talk-btn.busy {
  background: #ccc;
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
.keep-current-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;
  text-align: center;
  font-size: 26rpx;
  color: #333;
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
