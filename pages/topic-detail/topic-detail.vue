<template>
  <view class="page">
    <view class="content-area">
      <view v-if="!topic" class="empty">
        <text>主题不存在</text>
      </view>

      <view v-else>
        <view class="summary-card">
          <text class="section-label">汇总</text>
          <text class="summary-text">{{ topic.summary || '暂无汇总' }}</text>
          <view class="refresh-btn" @click="refreshSummary" :class="{ disabled: refreshing }">
            <text>{{ refreshing ? '生成中…' : '重新生成汇总' }}</text>
          </view>
          <text v-if="summaryError" class="error-text">{{ summaryError }}</text>
        </view>

        <text class="section-label fragments-label">碎片记录（{{ topic.fragments.length }}）</text>
        <view class="fragment-list">
          <view v-for="f in reversedFragments" :key="f.id" class="fragment-item">
            <text class="fragment-text">{{ f.text }}</text>
            <view v-if="f.aiAnswer" class="ai-answer-block">
              <text class="ai-tag">🤖 AI 回复</text>
              <text class="ai-answer-text">{{ f.aiAnswer }}</text>
            </view>
            <text class="fragment-time">{{ formatTime(f.createdAt) }} · {{ sourceLabel(f.source) }}</text>
          </view>
        </view>

        <view class="delete-btn" @click="confirmDelete">
          <text>删除主题</text>
        </view>
      </view>
    </view>

    <!-- opening this topic pins it as the selected one, so this bar keeps
         adding fragments straight here (per TODO: 保留录入想法的功能，位置不变) -->
    <capture-bar ref="captureBar" @saved="onSaved" @changed="onCaptureChanged" />
  </view>
</template>

<script>
import { getTopicById, updateTopicSummary, setSelectedTopicId, deleteTopic } from '@/utils/storage.js'
import { summarizeTopic } from '@/services/ai.js'

export default {
  data() {
    return {
      topicId: '',
      topic: null,
      refreshing: false,
      summaryError: ''
    }
  },
  computed: {
    reversedFragments() {
      return this.topic ? [...this.topic.fragments].reverse() : []
    }
  },
  watch: {
    // Fires regardless of which method (re)loaded the topic, so the nav
    // bar title stays in sync without repeating this call in three places.
    topic(newTopic) {
      if (newTopic) uni.setNavigationBarTitle({ title: newTopic.title })
    }
  },
  onLoad(query) {
    this.topicId = query.id
    // viewing a topic makes it the active one app-wide
    setSelectedTopicId(this.topicId)
  },
  onShow() {
    if (this.topicId) {
      this.topic = getTopicById(this.topicId)
    }
    if (this.$refs.captureBar) this.$refs.captureBar.refresh()
  },
  methods: {
    onSaved(topicId) {
      if (topicId === this.topicId) {
        // saved into the topic we're already viewing — just refresh in place
        this.topic = getTopicById(this.topicId)
      } else {
        // mismatch flow redirected the save elsewhere — follow it there
        // rather than leaving the user looking at the wrong topic
        uni.navigateTo({ url: `/pages/topic-detail/topic-detail?id=${topicId}` })
      }
    },
    onCaptureChanged() {
      if (this.topicId) {
        this.topic = getTopicById(this.topicId)
      }
    },
    async refreshSummary() {
      if (this.refreshing || !this.topic) return
      this.refreshing = true
      this.summaryError = ''
      try {
        const summary = await summarizeTopic(this.topic)
        this.topic = updateTopicSummary(this.topicId, summary)
      } catch (e) {
        // Honest failure — no fake summary text, per project rule.
        this.summaryError = 'AI汇总服务暂不可用，稍后再试'
        console.error(e)
      } finally {
        this.refreshing = false
      }
    },
    confirmDelete() {
      if (!this.topic) return
      // Irreversible — no undo, so require an explicit confirm rather than
      // a single tap. Mainly a recovery tool for AI mis-categorization
      // (e.g. a catch-all topic accidentally hoovering up unrelated
      // fragments), not something meant to be reached for casually.
      uni.showModal({
        title: '删除主题',
        content: `确定要删除「${this.topic.title}」吗？其中的 ${this.topic.fragments.length} 条碎片记录也会一并删除，且无法恢复。`,
        confirmText: '删除',
        confirmColor: '#DD524D',
        success: res => {
          if (res.confirm) {
            deleteTopic(this.topicId)
            uni.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => uni.navigateBack(), 400)
          }
        }
      })
    },
    formatTime(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    },
    sourceLabel(source) {
      if (source === 'voice') return '语音'
      if (source === 'ai') return 'AI'
      return '文字'
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
.content-area {
  flex: 1;
  padding: 24rpx;
  padding-bottom: 180rpx; /* leave room for the docked capture bar */
  box-sizing: border-box;
}
.section-label {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 12rpx;
}
.summary-card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
.summary-text {
  display: block;
  font-size: 28rpx;
  color: #333;
  line-height: 1.6;
  margin-bottom: 20rpx;
  white-space: pre-wrap; /* preserve the AI's bullet/line-break formatting instead of squashing it into one paragraph */
}
.refresh-btn {
  align-self: flex-start;
  display: inline-block;
  padding: 12rpx 24rpx;
  border: 2rpx solid #F97316;
  border-radius: 8rpx;
  color: #F97316;
  font-size: 24rpx;
  width: fit-content;
}
.refresh-btn.disabled {
  opacity: 0.5;
}
.error-text {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #DD524D;
}
.fragments-label {
  margin-bottom: 16rpx;
}
.fragment-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.fragment-item {
  background: #fff;
  border-radius: 12rpx;
  padding: 20rpx;
}
.fragment-text {
  display: block;
  font-size: 28rpx;
  color: #333;
  margin-bottom: 8rpx;
}
.ai-answer-block {
  background: #FFF7ED;
  border-left: 4rpx solid #F97316;
  border-radius: 8rpx;
  padding: 12rpx 16rpx;
  margin-bottom: 8rpx;
}
.ai-tag {
  display: block;
  font-size: 22rpx;
  color: #F97316;
  margin-bottom: 6rpx;
}
.ai-answer-text {
  display: block;
  font-size: 26rpx;
  color: #333;
  line-height: 1.5;
}
.fragment-time {
  display: block;
  font-size: 22rpx;
  color: #bbb;
}
.delete-btn {
  text-align: center;
  padding: 24rpx;
  margin-top: 40rpx;
  color: #bbb;
  font-size: 26rpx;
}
</style>
