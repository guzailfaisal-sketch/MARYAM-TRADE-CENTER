import { Product, Category, WebsiteSettings, MediaItem, WhatsAppInquiryClick, BRAND_CONFIG } from '../types';
import { CATEGORIES_DATA, INITIAL_PRODUCTS } from '../data/products';
import { fileToPermanentDataUrl, persistImageToIndexedDB, isDeadBlobUrl, getSafeImageUrl } from '../utils/imageStorage';

const TOKEN_KEY = 'mtc_admin_auth_token';
const STORAGE_KEY_PRODUCTS = 'mtc_storage_products';
const STORAGE_KEY_CATEGORIES = 'mtc_storage_categories';
const STORAGE_KEY_SETTINGS = 'mtc_storage_settings';
const STORAGE_KEY_MEDIA = 'mtc_storage_media';
const STORAGE_KEY_INQUIRIES = 'mtc_storage_inquiries';

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// Local Storage Fallback Store with Automatic Broken Image Repair
function sanitizeProduct(p: Product): Product {
  const safeMain = getSafeImageUrl(p.mainImage, p.category);
  const safeGallery = Array.isArray(p.galleryImages)
    ? p.galleryImages
        .map((img) => (isDeadBlobUrl(img) ? safeMain : img))
        .filter(Boolean)
    : [safeMain];

  return {
    ...p,
    mainImage: safeMain,
    galleryImages: safeGallery.length > 0 ? safeGallery : [safeMain],
  };
}

function getLocalProducts(): Product[] {
  if (typeof window === 'undefined') return INITIAL_PRODUCTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(sanitizeProduct);
      }
    }
  } catch {}
  return INITIAL_PRODUCTS;
}

function saveLocalProducts(products: Product[]): void {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = products.map(sanitizeProduct);
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(sanitized));
  } catch {}
}

function getLocalCategories(): Category[] {
  if (typeof window === 'undefined') return CATEGORIES_DATA;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORIES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return CATEGORIES_DATA;
}

function saveLocalCategories(categories: Category[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CATEGORIES, JSON.stringify(categories));
  } catch {}
}

function getLocalSettings(): WebsiteSettings {
  if (typeof window === 'undefined') return BRAND_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const merged = { ...BRAND_CONFIG, ...parsed };
        // Clean dead blob logo
        if (isDeadBlobUrl(merged.logo)) {
          merged.logo = undefined;
          merged.logoUrl = undefined;
        }
        return merged;
      }
    }
  } catch {}
  return BRAND_CONFIG;
}

function saveLocalSettings(settings: WebsiteSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch {}
}

function getLocalMedia(): MediaItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MEDIA);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((m) => !isDeadBlobUrl(m.url));
      }
    }
  } catch {}
  return [];
}

function saveLocalMedia(media: MediaItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    const safeMedia = media.filter((m) => !isDeadBlobUrl(m.url));
    localStorage.setItem(STORAGE_KEY_MEDIA, JSON.stringify(safeMedia));
  } catch {}
}

function getLocalInquiries(): WhatsAppInquiryClick[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INQUIRIES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveLocalInquiries(inquiries: WhatsAppInquiryClick[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_INQUIRIES, JSON.stringify(inquiries));
  } catch {}
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Endpoint returned non-JSON response');
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as T;
}

export const api = {
  // --- AUTH ---
  async login(username: string, password: string) {
    try {
      const res = await request<{ token: string; user: { id: string; username: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (res.token) {
        setStoredAuthToken(res.token);
      }
      return res;
    } catch (e: any) {
      throw new Error(e.message || 'Invalid username or password.');
    }
  },

  async logout() {
    try {
      await request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setStoredAuthToken(null);
    }
  },

  async getMe() {
    try {
      const user = await request<{ id: string; username: string }>('/api/auth/me');
      return { authenticated: true, user };
    } catch {
      setStoredAuthToken(null);
      return { authenticated: false };
    }
  },

  async changePassword(oldPassword: string, newPassword: string) {
    return await request<{ success: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  async getAdminUsers() {
    return await request<{ id: string; username: string; createdAt: string }[]>('/api/auth/users');
  },

  async createAdminUser(username: string, password: string) {
    return await request<{ id: string; username: string; createdAt: string }>('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async deleteAdminUser(id: string) {
    return await request<{ success: boolean }>(`/api/auth/users/${id}`, {
      method: 'DELETE',
    });
  },

  // --- PRODUCTS ---
  async getProducts(params?: { all?: boolean; category?: string; search?: string }): Promise<Product[]> {
    const query = new URLSearchParams();
    if (params?.all) query.set('all', 'true');
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString() ? `?${query.toString()}` : '';

    try {
      const res = await request<Product[]>(`/api/products${qs}`);
      if (Array.isArray(res)) {
        saveLocalProducts(res);
        return res;
      }
    } catch (err) {
      console.warn('Network request failed, falling back to local cache:', err);
    }

    let prods = getLocalProducts();
    if (!params?.all) {
      prods = prods.filter((p) => p.status === 'published' || p.isPublished === true);
    }
    if (params?.category && params.category !== 'all') {
      prods = prods.filter((p) => p.category === params.category);
    }
    return prods;
  },

  async getProduct(id: string): Promise<Product | null> {
    try {
      return await request<Product>(`/api/products/${id}`);
    } catch {
      const prods = getLocalProducts();
      return prods.find((p) => p.id === id) || null;
    }
  },

  async createProduct(data: Partial<Product>): Promise<Product> {
    const res = await request<Product>('/api/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!res || !res.id) {
      throw new Error('Database insertion failed: No valid product record returned.');
    }

    const prods = getLocalProducts();
    saveLocalProducts([res, ...prods.filter((p) => p.id !== res.id)]);
    return res;
  },

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    const res = await request<Product>(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    if (!res || !res.id) {
      throw new Error('Database update failed: No valid product record returned.');
    }

    const prods = getLocalProducts();
    saveLocalProducts(prods.map((p) => (p.id === id ? res : p)));
    return res;
  },

  async deleteProduct(id: string, hardDelete = false) {
    const res = await request<{ success: boolean }>(`/api/products/${id}${hardDelete ? '?hard=true' : ''}`, {
      method: 'DELETE',
    });
    const prods = getLocalProducts().filter((p) => p.id !== id);
    saveLocalProducts(prods);
    return res;
  },

  async duplicateProduct(id: string) {
    const res = await request<Product>(`/api/products/${id}/duplicate`, { method: 'POST' });
    if (res && res.id) {
      const prods = getLocalProducts();
      saveLocalProducts([res, ...prods]);
      return res;
    }
    throw new Error('Failed to duplicate product in production database.');
  },

  async reorderProducts(orderedIds: string[]) {
    const res = await request<{ success: boolean }>('/api/products/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
    const prods = getLocalProducts();
    orderedIds.forEach((pid, idx) => {
      const found = prods.find((p) => p.id === pid);
      if (found) found.displayOrder = idx + 1;
    });
    saveLocalProducts(prods);
    return res;
  },

  // --- CATEGORIES ---
  async getCategories(): Promise<Category[]> {
    try {
      const res = await request<Category[]>('/api/categories');
      if (Array.isArray(res) && res.length > 0) {
        saveLocalCategories(res);
        return res;
      }
    } catch {}
    return getLocalCategories();
  },

  async createCategory(data: Partial<Category>): Promise<Category> {
    try {
      const res = await request<Category>('/api/categories', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (res && res.id) {
        const cats = getLocalCategories();
        saveLocalCategories([...cats, res]);
        return res;
      }
    } catch {}

    const cats = getLocalCategories();
    const id = data.id || `cat-${Date.now().toString(36)}`;
    const newCat: Category = {
      id,
      name: data.name || 'New Category',
      slug: data.slug || (data.name || 'category').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      tagline: data.tagline || 'Curated boutique collection',
      image: data.image || 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=1000&auto=format&fit=crop',
      itemCount: 0,
      displayOrder: (cats.length || 0) + 1,
      isPublished: true,
    };
    saveLocalCategories([...cats, newCat]);
    return newCat;
  },

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    try {
      const res = await request<Category>(`/api/categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (res && res.id) {
        const cats = getLocalCategories();
        saveLocalCategories(cats.map((c) => (c.id === id || c.slug === id ? res : c)));
        return res;
      }
    } catch {}

    const cats = getLocalCategories();
    const index = cats.findIndex((c) => c.id === id || c.slug === id);
    if (index !== -1) {
      const updated = { ...cats[index], ...data };
      cats[index] = updated;
      saveLocalCategories(cats);
      return updated;
    }
    throw new Error('Category not found');
  },

  async deleteCategory(id: string) {
    try {
      await request<{ success: boolean }>(`/api/categories/${id}`, { method: 'DELETE' });
    } catch {}
    const cats = getLocalCategories().filter((c) => c.id !== id && c.slug !== id);
    saveLocalCategories(cats);
    return { success: true };
  },

  async reorderCategories(orderedIds: string[]) {
    try {
      await request<{ success: boolean }>('/api/categories/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });
    } catch {}
    const cats = getLocalCategories();
    orderedIds.forEach((cid, idx) => {
      const found = cats.find((c) => c.id === cid || c.slug === cid);
      if (found) found.displayOrder = idx + 1;
    });
    saveLocalCategories(cats);
    return { success: true };
  },

  // --- WEBSITE SETTINGS ---
  async getSettings(): Promise<WebsiteSettings> {
    try {
      const res = await request<WebsiteSettings>('/api/settings');
      if (res && typeof res === 'object') {
        saveLocalSettings(res);
        return res;
      }
    } catch {}
    return getLocalSettings();
  },

  async updateSettings(data: Partial<WebsiteSettings>): Promise<WebsiteSettings> {
    try {
      const res = await request<WebsiteSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      if (res && typeof res === 'object') {
        saveLocalSettings(res);
        return res;
      }
    } catch {}
    const current = getLocalSettings();
    const updated = { ...current, ...data };
    saveLocalSettings(updated);
    return updated;
  },

  // --- MEDIA ---
  async getMedia(): Promise<MediaItem[]> {
    try {
      const res = await request<MediaItem[]>('/api/media');
      if (Array.isArray(res)) {
        saveLocalMedia(res);
        return res;
      }
    } catch {}
    return getLocalMedia();
  },

  async uploadImages(files: File[]): Promise<{ urls: string[]; items: MediaItem[] }> {
    if (!files || files.length === 0) {
      return { urls: [], items: [] };
    }

    // Convert client files into persistent Data URL payloads for upload
    const payloadImages: { dataUrl: string; name: string; size: number; mimeType: string }[] = [];
    for (const file of files) {
      const permanentDataUrl = await fileToPermanentDataUrl(file);
      payloadImages.push({
        dataUrl: permanentDataUrl,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'image/jpeg',
      });
    }

    // Upload directly to production server storage
    const res = await request<{ urls: string[]; items: MediaItem[] }>('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify({ images: payloadImages }),
    });

    if (!res || !Array.isArray(res.urls) || res.urls.length === 0) {
      throw new Error('Image upload failed: Server did not return image storage paths.');
    }

    const existing = getLocalMedia();
    saveLocalMedia([...(res.items || []), ...existing]);
    return res;
  },

  async deleteMedia(id: string) {
    try {
      await request<{ success: boolean }>(`/api/media/${id}`, { method: 'DELETE' });
    } catch {}
    const media = getLocalMedia().filter((m) => m.id !== id);
    saveLocalMedia(media);
    return { success: true };
  },

  // --- ANALYTICS / INQUIRIES ---
  async trackInquiry(data: Partial<WhatsAppInquiryClick>): Promise<WhatsAppInquiryClick | null> {
    try {
      const res = await request<WhatsAppInquiryClick>('/api/inquiries/track', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (res && res.id) return res;
    } catch {}

    const item: WhatsAppInquiryClick = {
      id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: data.productId || '',
      productName: data.productName || 'General Inquiry',
      productSku: data.productSku || '',
      price: data.price,
      selectedSize: data.selectedSize,
      selectedColor: data.selectedColor,
      timestamp: new Date().toISOString(),
      sourceUrl: data.sourceUrl,
    };
    const inquiries = getLocalInquiries();
    saveLocalInquiries([item, ...inquiries.slice(0, 499)]);
    return item;
  },

  async trackWhatsAppClick(data: Partial<WhatsAppInquiryClick>) {
    return this.trackInquiry(data);
  },

  async getInquiries(): Promise<WhatsAppInquiryClick[]> {
    try {
      const res = await request<WhatsAppInquiryClick[]>('/api/inquiries');
      if (Array.isArray(res)) {
        saveLocalInquiries(res);
        return res;
      }
    } catch {}
    return getLocalInquiries();
  },

  // --- DASHBOARD STATS ---
  async getDashboardStats() {
    try {
      const res = await request<any>('/api/dashboard/stats');
      if (res && typeof res === 'object') return res;
    } catch {}

    const prods = getLocalProducts();
    const cats = getLocalCategories();
    const inqs = getLocalInquiries();
    const published = prods.filter((p) => p.status === 'published' || p.isPublished);
    const drafts = prods.filter((p) => p.status === 'draft' || (!p.isPublished && p.status !== 'archived'));

    return {
      totalPublishedProducts: published.length,
      totalDraftProducts: drafts.length,
      totalArchivedProducts: prods.filter((p) => p.status === 'archived').length,
      totalCategories: cats.length,
      newArrivalsCount: published.filter((p) => p.newArrival || p.isNewArrival).length,
      featuredCount: published.filter((p) => p.featured || p.isFeatured).length,
      inStockCount: published.filter((p) => p.inStock).length,
      outOfStockCount: published.filter((p) => !p.inStock).length,
      totalWhatsAppClicks: inqs.length,
      recentInquiries: inqs.slice(0, 10),
      recentProducts: prods.slice(0, 5),
    };
  },
};
