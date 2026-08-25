function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900">ReachInbox Email Scheduler</h1>
        <p className="text-gray-600 mt-2 text-center">Phase 1 Infrastructure Ready</p>
      </header>
      <main className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-md">
            <span className="text-green-800 font-medium">React + Vite</span>
            <span className="text-green-600">✓</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-md">
            <span className="text-blue-800 font-medium">Tailwind CSS</span>
            <span className="text-blue-600">✓</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
