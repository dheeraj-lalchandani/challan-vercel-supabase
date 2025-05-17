
import { useState, useEffect } from 'react';

export default function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const handleUpload = async () => {
    if (!file) return alert('Please select a file');
    setLoading(true);
    setDownloadUrl(null);

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/process-csv', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
    fetchTransactions();
    setLoading(false);
  };

  const fetchTransactions = async () => {
    const res = await fetch('/api/transactions');
    const data = await res.json();
    setTransactions(data);
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-6">
        <h1 className="text-xl font-bold mb-4">Upload Vehicle CSV to Fetch Challans</h1>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files[0])}
          className="mb-4 w-full"
        />
        <button
          onClick={handleUpload}
          disabled={loading}
          className={`w-full py-2 rounded text-white ${loading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {loading ? 'Processing...' : 'Upload & Process'}
        </button>
        {downloadUrl && (
          <a href={downloadUrl} download className="block mt-4 text-blue-600 underline">
            Download Challan Results
          </a>
        )}
      </div>

      <div className="max-w-5xl mx-auto mt-8">
        <h2 className="text-lg font-semibold mb-2">Transaction History</h2>
        <table className="min-w-full text-sm bg-white rounded-xl">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left">Timestamp</th>
              <th className="px-4 py-2">Input</th>
              <th className="px-4 py-2"># Records</th>
              <th className="px-4 py-2">Output</th>
              <th className="px-4 py-2"># Success</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => (
              <tr key={txn.id} className="border-t">
                <td className="px-4 py-2 whitespace-nowrap">{new Date(txn.timestamp).toLocaleString()}</td>
                <td className="px-4 py-2"><a href={txn.input_file_url} className="text-blue-600 underline">Input</a></td>
                <td className="px-4 py-2 text-center">{txn.input_count}</td>
                <td className="px-4 py-2"><a href={txn.output_file_url} className="text-blue-600 underline">Output</a></td>
                <td className="px-4 py-2 text-center">{txn.output_count}</td>
                <td className="px-4 py-2 text-center">{txn.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
