<template>
  <view class="page">
    <view class="list-area">
      <view v-if="topics.length === 0" class="empty">
        <text class="empty-title">No topics yet</text>
        <text class="empty-sub">Hold to speak below, or tap the keyboard to type your first note</text>
      </view>

      <view v-else class="list">
        <view
          v-for="topic in topics"
          :key="topic.id"
          class="card"
          :class="{ selected: topic.id === selectedTopicId }"
          @click="openTopic(topic.id)"
          @longpress="onTopicLongPress(topic)"
        >
          <view class="card-header">
            <view class="card-title-row">
              <text class="card-title">{{ topic.title }}</text>
              <text v-if="topic.id === selectedTopicId" class="selected-badge">Selected</text>
            </view>
            <text class="card-count">{{ topic.fragments.length }} notes</text>
          </view>
          <text class="card-summary">{{ topic.summary ? markdownToPlain(topic.summary) : 'No summary yet' }}</text>
          <text class="card-time">{{ formatTime(topic.updatedAt) }}</text>
        </view>
      </view>
    </view>

    <capture-bar ref="captureBar" @saved="onSaved" @changed="onCaptureChanged" />
    <ai-consent-gate />
  </view>
</template>

<script>
import { markdownToPlain } from '@/utils/markdown.js'
import { getTopics, getSelectedTopicId, deleteTopic } from '@/utils/storage.js'

export default {
  data() {
    return {
      topics: [],
      selectedTopicId: null
    }
  },
  onShow() {
    this.refresh()
    // capture bar has no page lifecycle of its own — nudge it to re-read
    // storage whenever this page becomes visible again
    if (this.$refs.captureBar) this.$refs.captureBar.refresh()
  },
  methods: {
    markdownToPlain,
    refresh() {
      this.topics = getTopics()
      this.selectedTopicId = getSelectedTopicId()
    },
    onSaved(topicId) {
      this.refresh()
      // land on the topic so the user can see where the fragment went,
      // instead of leaving them guessing on the home screen
      uni.navigateTo({ url: `/pages/topic-detail/topic-detail?id=${topicId}` })
    },
    onCaptureChanged() {
      this.refresh()
    },
    openTopic(topicId) {
      uni.navigateTo({ url: `/pages/topic-detail/topic-detail?id=${topicId}` })
    },
    onTopicLongPress(topic) {
      uni.showActionSheet({
        itemList: ['Delete Topic'],
        itemColor: '#DD524D',
        success: res => {
          if (res.tapIndex === 0) this.confirmDeleteTopic(topic)
        }
      })
    },
    confirmDeleteTopic(topic) {
      // Irreversible — no undo, so require an explicit confirm rather than
      // acting straight off the long-press + action sheet tap.
      uni.showModal({
        title: 'Delete Topic',
        content: `Delete "${topic.title}"? This will also delete its ${topic.fragments.length} notes, and cannot be undone.`,
        confirmText: 'Delete',
        confirmColor: '#DD524D',
        success: res => {
          if (res.confirm) {
            deleteTopic(topic.id)
            this.refresh()
            if (this.$refs.captureBar) this.$refs.captureBar.refresh()
            uni.showToast({ title: 'Deleted', icon: 'success' })
          }
        }
      })
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
  padding-bottom: 180rpx; /* leave room for the docked capture bar */
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
  border: 2rpx solid transparent;
}
.card.selected {
  border-color: #F97316;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.selected-badge {
  font-size: 20rpx;
  color: #fff;
  background: #F97316;
  padding: 2rpx 12rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
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
</style>
