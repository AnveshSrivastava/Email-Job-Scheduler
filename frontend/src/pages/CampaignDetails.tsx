import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { Campaign, Job } from '../types';
import { ArrowLeft, Clock, Mail, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

export const CampaignDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchCampaign = async () => {
    try {
      setLoading(true);
      const [batchRes, jobsRes] = await Promise.all([
        apiClient.get(`/campaigns/${id}`),
        apiClient.get(`/campaigns/${id}/jobs?page=${page}&limit=10`),
      ]);
      setCampaign(batchRes.data.data);
      setJobs(jobsRes.data.data);
      setTotalPages(Math.ceil(jobsRes.data.pagination.total / 10));
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errorObj = err as any;
      setError(errorObj.response?.data?.error?.message || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line
    if (id) fetchCampaign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page]);

  if (loading && !campaign) {
    return <div className="flex justify-center p-12">Loading...</div>;
  }

  if (error || !campaign) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700">
        <p>{error || 'Campaign not found'}</p>
        <Link to="/dashboard" className="text-red-800 underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SENT':
        return <CheckCircle className="text-green-500" size={18} />;
      case 'FAILED':
        return <XCircle className="text-red-500" size={18} />;
      case 'PROCESSING':
        return <Clock className="text-yellow-500" size={18} />;
      case 'SCHEDULED':
        return <Clock className="text-blue-500" size={18} />;
      default:
        return <AlertCircle className="text-gray-400" size={18} />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-6"
      >
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>

      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <h2 className="text-2xl font-bold mb-4">{campaign.subject}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-gray-50 p-3 rounded border">
            <span className="block text-gray-500 mb-1">Total Recipients</span>
            <span className="font-semibold text-lg">{campaign.totalCount}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded border">
            <span className="block text-gray-500 mb-1">Hourly Limit</span>
            <span className="font-semibold text-lg">{campaign.hourlyLimit}</span>
          </div>
          <div className="bg-gray-50 p-3 rounded border">
            <span className="block text-gray-500 mb-1">Delay</span>
            <span className="font-semibold text-lg">{campaign.delaySeconds}s</span>
          </div>
          <div className="bg-gray-50 p-3 rounded border">
            <span className="block text-gray-500 mb-1">Start At</span>
            <span className="font-semibold">{new Date(campaign.startAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Mail size={18} /> Jobs
          </h3>
          <button onClick={fetchCampaign} className="text-sm text-blue-600 hover:underline">
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100 text-gray-600 uppercase">
              <tr>
                <th className="px-6 py-3">Recipient</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Scheduled At</th>
                <th className="px-6 py-3">Sent At</th>
                <th className="px-6 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium">{job.recipient}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.status)}
                      <span className="font-semibold">{job.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {new Date(job.scheduledAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {job.sentAt ? new Date(job.sentAt).toLocaleString() : '-'}
                  </td>
                  <td
                    className="px-6 py-4 text-red-500 max-w-xs truncate"
                    title={job.errorMessage || ''}
                  >
                    {job.errorMessage || '-'}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No jobs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t flex justify-between items-center bg-gray-50">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-4 py-2 border rounded bg-white disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 border rounded bg-white disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
