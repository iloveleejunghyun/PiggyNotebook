<template>
  <view class="page">
    <view class="content-area">
      <view v-if="!topic" class="empty">
        <text>Topic not found</text>
      </view>

      <view v-else>
        <view class="summary-card">
          <text class="section-label">Summary</text>
          <rich-text v-if="topic.summary" class="summary-text" :nodes="summaryHtml" user-select></rich-text>
          <text v-else class="summary-text">No summary yet</text>
          <text v-if="topic.summaryFailed" class="error-text">Summary couldn't update — it will refresh with your next note.</text>
        </view>

        <text class="section-label fragments-label">Notes ({{ topic.fragments.length }})</text>
        <view class="fragment-list">
          <view v-for="f in reversedFragments" :key="f.id" class="fragment-item" @longpress="onFragmentLongPress(f)">
            <text class="fragment-text">{{ f.text }}</text>
            <view v-if="f.aiAnswer" class="ai-answer-block">
              <text class="ai-tag">🤖 AI Reply</text>
              <text class="ai-answer-text">{{ f.aiAnswer }}</text>
            </view>
            <text class="fragment-time">{{ formatTime(f.createdAt) }} · {{ sourceLabel(f.source) }}</text>
          </view>
        </view>

        <view class="delete-btn" @click="confirmDelete">
          <text>Delete Topic</text>
        </view>
      </view>
    </view>

    <!-- opening this topic pins it as the selected one, so this bar keeps
         adding fragments straight here (per TODO: 保留录入想法的功能，位置不变) -->
    <capture-bar ref="captureBar" @saved="onSaved" @changed="onCaptureChanged" />
  </view>
</template>

<script>
import { getTopicById, setSelectedTopicId, deleteTopic, deleteFragment } from '@/utils/storage.js'
import { markdownToHtml } from '@/utils/markdown.js'

export default {
  data() {
    return {
      topicId: '',
      topic: null
    }
  },
  computed: {
    summaryHtml() {
      return markdownToHtml(this.topic ? this.topic.summary : '')
    },
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
    onFragmentLongPress(fragment) {
      uni.showActionSheet({
        itemList: ['Delete Note'],
        itemColor: '#DD524D',
        success: res => {
          if (res.tapIndex === 0) this.confirmDeleteFragment(fragment)
        }
      })
    },
    confirmDeleteFragment(fragment) {
      uni.showModal({
        title: 'Delete Note',
        content: 'Delete this note? This cannot be undone. The summary will update the next time you add a note.',
        confirmText: 'Delete',
        confirmColor: '#DD524D',
        success: res => {
          if (res.confirm) {
            this.topic = deleteFragment(this.topicId, fragment.id)
            uni.showToast({ title: 'Deleted', icon: 'success' })
          }
        }
      })
    },
    confirmDelete() {
      if (!this.topic) return
      // Irreversible — no undo, so require an explicit confirm rather than
      // a single tap. Mainly a recovery tool for AI mis-categorization
      // (e.g. a catch-all topic accidentally hoovering up unrelated
      // fragments), not something meant to be reached for casually.
      uni.showModal({
        title: 'Delete Topic',
        content: `Delete "${this.topic.title}"? This will also delete its ${this.topic.fragments.length} notes, and cannot be undone.`,
        confirmText: 'Delete',
        confirmColor: '#DD524D',
        success: res => {
          if (res.confirm) {
            deleteTopic(this.topicId)
            uni.showToast({ title: 'Deleted', icon: 'success' })
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
      if (source === 'voice') return 'Voice'
      if (source === 'ai') return 'AI'
      return 'Text'
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
