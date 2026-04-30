'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (data.success) {
        router.push('/dashboard');
      } else {
        setError(data.error || '登录失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-sm border p-8" style={{ borderColor: '#EEEEEE' }}>
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg mb-4" style={{ backgroundColor: '#0073E6' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold" style={{ color: '#333' }}>测试用例管理平台</h1>
            <p className="mt-2 text-sm" style={{ color: '#666' }}>测试用例数据的统一管理与协作</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#333' }}>用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-md text-sm focus:outline-none focus:ring-2 transition-colors"
                style={{ borderColor: '#EEEEEE', color: '#333' }}
                onFocus={(e) => { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#EEEEEE'; e.target.style.boxShadow = 'none'; }}
                placeholder="请输入用户名"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#333' }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-md text-sm focus:outline-none focus:ring-2 transition-colors"
                style={{ borderColor: '#EEEEEE', color: '#333' }}
                onFocus={(e) => { e.target.style.borderColor = '#0073E6'; e.target.style.boxShadow = '0 0 0 2px rgba(0,115,230,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#EEEEEE'; e.target.style.boxShadow = 'none'; }}
                placeholder="请输入密码"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-md">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#0073E6' }}
              onMouseOver={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#0062CC'; }}
              onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#0073E6'; }}
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>
        </div>

        <p className="text-center mt-4 text-xs" style={{ color: '#999' }}>
          测试用例管理平台 v1.0
        </p>
      </div>
    </div>
  );
}
