<template>
  <view class="page">
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
          <text class="fragment-time">{{ formatTime(f.createdAt) }} · {{ f.source === 'voice' ? '语音' : '文字' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getTopicById, updateTopicSummary } from '@/utils/storage.js'
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
  onLoad(query) {
    this.topicId = query.id
  },
  onShow() {
    if (this.topicId) {
      this.topic = getTopicById(this.topicId)
    }
  },
  methods: {
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
  padding: 24rpx;
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
.fragment-time {
  display: block;
  font-size: 22rpx;
  color: #bbb;
}
</style>
