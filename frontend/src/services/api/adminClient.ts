import axios from 'axios';
import { getAdminToken, setAdminToken } from '../auth/adminTokenStore';

const adminApi = axios.create({
  baseURL: '/api/platform-admin',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true,
});

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        const res = await axios.post('/api/auth/refresh', {}, {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
          withCredentials: true,
        });
        const newToken = res.data.accessToken;
        setAdminToken(newToken);
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return adminApi(error.config);
      } catch {
        setAdminToken(null);
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(error);
  },
);

export default adminApi;
