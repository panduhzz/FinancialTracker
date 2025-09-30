// DataCache class for API response caching
class DataCache {
  constructor() {
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes default
    this.maxCacheSize = 50; // Maximum number of cache entries
    this.storageKey = 'financial_tracker_cache';
    this.timestampsKey = 'financial_tracker_timestamps';

    // Load existing cache from localStorage
    this.loadFromStorage();
    
    // Cache TTL configuration for different API endpoints
    this.cacheConfig = {
      '/api/accounts': 10 * 60 * 1000, // 10 minutes
      '/api/financial-summary': 5 * 60 * 1000, // 5 minutes
      '/api/transactions/recent': 2 * 60 * 1000, // 2 minutes
      '/api/accounts/summary/': 5 * 60 * 1000, // 5 minutes
      '/api/analytics/monthly-summary': 30 * 60 * 1000, // 30 minutes
      '/api/analytics/balance-history': 15 * 60 * 1000, // 15 minutes
      '/api/analytics/account-balance': 15 * 60 * 1000, // 15 minutes
      '/api/transactions/search': 1 * 60 * 1000 // 1 minute for search results
    };
  }

  /**
   * Load cache from localStorage
   */
  loadFromStorage() {
    try {
      const storedCache = localStorage.getItem(this.storageKey);
      const storedTimestamps = localStorage.getItem(this.timestampsKey);
      
      if (storedCache) {
        const cacheData = JSON.parse(storedCache);
        this.cache = new Map(Object.entries(cacheData));
        console.log(`📦 Loaded ${this.cache.size} cache entries from localStorage`);
      }
      
      if (storedTimestamps) {
        const timestampData = JSON.parse(storedTimestamps);
        this.cacheTimestamps = new Map(Object.entries(timestampData));
        console.log(`⏰ Loaded ${this.cacheTimestamps.size} cache timestamps from localStorage`);
      }
      
      // Clean up expired entries on load
      this.cleanupExpired();
    } catch (error) {
      console.warn('Failed to load cache from localStorage:', error);
      this.cache = new Map();
      this.cacheTimestamps = new Map();
    }
  }

  /**
   * Save cache to localStorage
   */
  saveToStorage() {
    try {
      const cacheData = Object.fromEntries(this.cache);
      const timestampData = Object.fromEntries(this.cacheTimestamps);
      
      localStorage.setItem(this.storageKey, JSON.stringify(cacheData));
      localStorage.setItem(this.timestampsKey, JSON.stringify(timestampData));
      
      console.log(`💾 Saved ${this.cache.size} cache entries to localStorage`);
    } catch (error) {
      console.warn('Failed to save cache to localStorage:', error);
    }
  }

  /**
   * Get TTL for a specific URL
   * @param {string} url - The API URL
   * @returns {number} TTL in milliseconds
   */
  getTTL(url) {
    // Find matching cache config
    for (const [pattern, ttl] of Object.entries(this.cacheConfig)) {
      if (url.includes(pattern)) {
        return ttl;
      }
    }
    return this.defaultTTL;
  }


  /**
   * Clean up expired entries
   */
  cleanupExpired() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, expiry] of this.cacheTimestamps.entries()) {
      if (now > expiry) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
    });
    
    if (keysToDelete.length > 0 && window.cacheDebug) {
      console.log(`🧹 Cleaned up ${keysToDelete.length} expired cache entries`);
    }
  }

  /**
   * Set cache entry with TTL
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, data, ttl = null) {
    const actualTTL = ttl || this.getTTL(key);
    
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      this.evictOldest();
    }
    
    this.cache.set(key, data);
    this.cacheTimestamps.set(key, Date.now() + actualTTL);
    
    // Save to localStorage
    this.saveToStorage();
    
    console.log(`💾 Cache SET: ${key} (TTL: ${actualTTL}ms, Size: ${this.cache.size})`);
  }

  /**
   * Evict the oldest cache entry (LRU)
   */
  evictOldest() {
    if (this.cache.size === 0) return;
    
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (timestamp < oldestTime) {
        oldestTime = timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.cacheTimestamps.delete(oldestKey);
      
      if (window.cacheDebug) {
        console.log(`🗑️ Evicted oldest cache entry: ${oldestKey}`);
      }
    }
  }

  /**
   * Get cached data if not expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached data or null if expired/not found
   */
  get(key) {
    console.log(`🔍 Cache GET: ${key} (cache size: ${this.cache.size})`);
    
    if (!this.cache.has(key)) {
      console.log(`❌ Cache MISS: ${key} (not found)`);
      return null;
    }
    
    const expiry = this.cacheTimestamps.get(key);
    if (Date.now() > expiry) {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
      console.log(`❌ Cache MISS: ${key} (expired)`);
      return null;
    }
    
    console.log(`✅ Cache HIT: ${key}`);
    return this.cache.get(key);
  }

  /**
   * Invalidate cache entries matching a pattern
   * @param {string} pattern - Pattern to match against cache keys
   */
  invalidate(pattern) {
    const keysToDelete = [];
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
    });
    
    // Save to localStorage after invalidation
    if (keysToDelete.length > 0) {
      this.saveToStorage();
      console.log(`🗑️ Cache INVALIDATED: ${keysToDelete.length} entries matching "${pattern}"`);
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.cacheTimestamps.clear();
    
    // Clear from localStorage
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.timestampsKey);
    
    console.log('🗑️ Cache CLEARED: All entries removed from memory and localStorage');
  }

  /**
   * Get cache statistics
   * @returns {object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      memoryUsage: JSON.stringify(Array.from(this.cache.values())).length
    };
  }
}

// Create global cache instance
window.dataCache = new DataCache();

// Debug: Confirm cache initialization
console.log('🚀 Cache initialized:', !!window.dataCache);
console.log('📊 Cache stats:', window.dataCache.getStats());
console.log('💾 Cache persistence: localStorage enabled');

// Add cache status function for easy debugging
window.getCacheStatus = () => {
  const stats = window.dataCache.getStats();
  console.log('📊 Cache Status:', {
    size: stats.size,
    keys: stats.keys,
    memoryUsage: stats.memoryUsage
  });
  return stats;
};

// Add function to check cache directly
window.checkCache = () => {
  console.log('🔍 Cache Data:', {
    memorySize: window.dataCache.cache.size,
    memoryKeys: Array.from(window.dataCache.cache.keys()),
    timestamps: Array.from(window.dataCache.cacheTimestamps.entries())
  });
  
  return {
    memoryCache: Array.from(window.dataCache.cache.entries()),
    timestamps: Array.from(window.dataCache.cacheTimestamps.entries())
  };
};

// Cache invalidation patterns for different operations
window.cacheInvalidation = {
  // Invalidate all user data after account changes
  invalidateUserData() {
    console.log('🗑️ Invalidating user data cache');
    window.dataCache.invalidate('/api/accounts');
    window.dataCache.invalidate('/api/financial-summary');
    window.dataCache.invalidate('/api/transactions');
    window.dataCache.invalidate('/api/analytics');
  },

  // Invalidate account-specific data
  invalidateAccountData(accountId) {
    console.log(`🗑️ Invalidating account data cache for account ${accountId}`);
    window.dataCache.invalidate(`/api/accounts/summary/${accountId}`);
    window.dataCache.invalidate('/api/accounts');
    window.dataCache.invalidate('/api/financial-summary');
  },

  // Invalidate transaction data
  invalidateTransactionData() {
    console.log('🗑️ Invalidating transaction data cache');
    window.dataCache.invalidate('/api/transactions');
    window.dataCache.invalidate('/api/financial-summary');
    window.dataCache.invalidate('/api/analytics');
  }
};

// Debug functions for development
window.cacheDebug = true; // Enable by default for testing
window.enableCacheDebug = () => {
  window.cacheDebug = true;
  console.log('Cache debugging enabled');
};

window.disableCacheDebug = () => {
  window.cacheDebug = false;
  console.log('Cache debugging disabled');
};

// Manual cache clearing for testing
window.clearAllCache = () => {
  if (window.dataCache) {
    window.dataCache.clear();
    console.log('🧹 Manual cache clear completed');
  }
};

// Force refresh all data (useful for debugging)
window.forceRefreshAllData = () => {
  if (window.dataCache) {
    window.dataCache.clear();
    console.log('🔄 Forcing refresh of all data...');
    
    // Reload the page to force fresh data fetch
    if (typeof window.location !== 'undefined') {
      window.location.reload();
    }
  }
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataCache };
}
