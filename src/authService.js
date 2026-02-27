// Centralized Authentication Service
// Firebase compat SDK wrapper — same public interface as the previous MSAL version

class AuthService {
  static instance = null;

  constructor() {
    this._initialized = false;
    this._auth = null;
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new AuthService();
    }
    return this.instance;
  }

  async initialize() {
    if (!this._initialized) {
      const firebaseConfig = {
        apiKey: window.REACT_APP_FIREBASE_API_KEY,
        authDomain: window.REACT_APP_FIREBASE_AUTH_DOMAIN,
        projectId: window.REACT_APP_FIREBASE_PROJECT_ID,
      };

      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      this._auth = firebase.auth();
      this._initialized = true;
    }
    return this._auth;
  }

  async signIn() {
    const auth = await this.initialize();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await auth.signInWithPopup(provider);
      // Map to an MSAL-compatible shape so auth.js works unchanged
      const nameParts = (result.user.displayName || '').split(' ');
      return {
        account: {
          idTokenClaims: {
            given_name: nameParts[0] || result.user.email,
            family_name: nameParts.slice(1).join(' ') || '',
          }
        }
      };
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  async signOut() {
    const auth = await this.initialize();
    try {
      await auth.signOut();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  async getCurrentUser() {
    const auth = await this.initialize();
    // Wait for Firebase to determine auth state (handles page-load race condition)
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        if (user) {
          resolve({
            id: user.uid,
            name: user.displayName || user.email,
            email: user.email,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async getToken() {
    const auth = await this.initialize();
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No authenticated user found');
    }
    return user.getIdToken();
  }

  // Centralized authenticated request with caching
  async makeAuthenticatedRequest(url, options = {}) {
    const method = options.method || 'GET';
    const cacheKey = `${method}_${url}`;

    // Check cache for GET requests only
    if (method === 'GET' && window.dataCache) {
      const cached = window.dataCache.get(cacheKey);
      if (cached) {
        return {
          ok: cached.ok,
          status: cached.status,
          statusText: cached.statusText,
          json: async () => cached.data,
          text: async () => JSON.stringify(cached.data),
          headers: new Headers(cached.headers || {})
        };
      }
    }

    try {
      const token = await this.getToken();

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      };

      const response = await fetch(url, {
        ...options,
        headers
      });

      // Cache successful GET responses
      if (method === 'GET' && response.ok && window.dataCache) {
        try {
          const data = await response.clone().json();
          window.dataCache.set(cacheKey, {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            data: data,
            headers: Object.fromEntries(response.headers.entries())
          });
        } catch (jsonError) {
          console.warn('Failed to cache response (not JSON):', jsonError);
        }
      }

      return response;
    } catch (error) {
      console.error('Error making authenticated request:', error);
      throw error;
    }
  }
}

// Make globally accessible
window.AuthService = AuthService;
