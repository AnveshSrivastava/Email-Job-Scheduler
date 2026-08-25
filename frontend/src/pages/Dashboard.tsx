import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { Sender } from '../types';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'json' | 'csv'>('json');

  const [senders, setSenders] = useState<Sender[]>([]);
  const [fetchingSenders, setFetchingSenders] = useState(true);

  // New Sender Form
  const [newSenderEmail, setNewSenderEmail] = useState('');
  const [newSenderName, setNewSenderName] = useState('');

  // JSON Form State
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState(new Date().toISOString().slice(0, 16));
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [recipients, setRecipients] = useState('');
  const [senderId, setSenderId] = useState('');

  // CSV Form State
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSenders = async () => {
      try {
        const res = await apiClient.get('/senders');
        setSenders(res.data.data);
        if (res.data.data.length > 0) {
          setSenderId(res.data.data[0].id);
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorObj = err as any;
        setError(
          errorObj.response?.data?.error?.message || errorObj.message || 'Failed to load senders',
        );
      } finally {
        setFetchingSenders(false);
      }
    };
    fetchSenders();
  }, []);

  const createSender = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/senders', {
        email: newSenderEmail,
        displayName: newSenderName,
      });
      setSenders([...senders, res.data.data]);
      setSenderId(res.data.data.id);
      setNewSenderEmail('');
      setNewSenderName('');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorObj = err as any;
      setError(
        errorObj.response?.data?.error?.message || errorObj.message || 'Failed to create sender',
      );
    } finally {
      setLoading(false);
    }
  };

  const submitJson = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const recipientList = recipients
        .split(',')
        .map((r) => ({ email: r.trim() }))
        .filter((r) => r.email);
      const payload = {
        senderId: senderId,
        subject,
        body,
        startAt: new Date(startAt).toISOString(),
        delaySeconds: Number(delaySeconds),
        hourlyLimit: Number(hourlyLimit),
        recipients: recipientList,
      };

      const res = await apiClient.post('/campaigns', payload);
      navigate(`/campaigns/${res.data.data.batch.id}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorObj = err as any;
      setError(errorObj.response?.data?.error?.message || errorObj.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const submitCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a CSV file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('senderId', senderId);
      formData.append('subject', subject);
      formData.append('body', body);
      formData.append('startAt', new Date(startAt).toISOString());
      formData.append('delaySeconds', delaySeconds.toString());
      formData.append('hourlyLimit', hourlyLimit.toString());

      const res = await apiClient.post('/campaigns/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      navigate(`/campaigns/${res.data.data.batch.id}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorObj = err as any;
      setError(errorObj.response?.data?.error?.message || errorObj.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (fetchingSenders) {
    return <div className="text-center p-12">Loading...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Dashboard</h2>
        <p className="text-gray-600">Schedule email campaigns or manage your senders.</p>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 text-red-700">
          <p>{error}</p>
        </div>
      )}

      {senders.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-bold mb-4">Create Your First Sender</h3>
          <p className="text-gray-600 mb-6">
            Before scheduling a campaign, you need to configure a sender identity.
          </p>
          <form onSubmit={createSender} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender Email</label>
              <input
                required
                type="email"
                value={newSenderEmail}
                onChange={(e) => setNewSenderEmail(e.target.value)}
                className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="hello@yourcompany.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name (Optional)
              </label>
              <input
                type="text"
                value={newSenderName}
                onChange={(e) => setNewSenderName(e.target.value)}
                className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Your Company Team"
              />
            </div>
            <button
              disabled={loading}
              type="submit"
              className="w-full bg-blue-600 text-white font-medium py-2 px-4 rounded-md shadow hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Sender'}
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="flex border-b">
            <button
              className={`flex-1 py-3 px-4 text-center font-medium ${activeTab === 'json' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setActiveTab('json')}
            >
              Manual Entry (JSON)
            </button>
            <button
              className={`flex-1 py-3 px-4 text-center font-medium ${activeTab === 'csv' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
              onClick={() => setActiveTab('csv')}
            >
              CSV Import
            </button>
          </div>

          <div className="p-6">
            <form onSubmit={activeTab === 'json' ? submitJson : submitCsv} className="space-y-6">
              {/* Common Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sender</label>
                  <select
                    required
                    value={senderId}
                    onChange={(e) => setSenderId(e.target.value)}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName ? `${s.displayName} <${s.email}>` : s.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start At</label>
                  <input
                    required
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    required
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                  <textarea
                    required
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Delay Seconds
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hourly Limit
                  </label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(Number(e.target.value))}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Tab Specific Fields */}
              {activeTab === 'json' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Recipients (comma separated emails)
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={recipients}
                    onChange={(e) => setRecipients(e.target.value)}
                    placeholder="alice@example.com, bob@example.com"
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
                  <input
                    required
                    type="file"
                    accept=".csv"
                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                    className="w-full border-gray-300 rounded-md shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                  />
                  <p className="mt-1 text-sm text-gray-500">File must contain an 'email' column.</p>
                </div>
              )}

              <div className="pt-4 border-t">
                <button
                  disabled={loading}
                  type="submit"
                  className="w-full bg-blue-600 text-white font-medium py-3 px-4 rounded-md shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Creating Campaign...' : 'Schedule Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
