import MiniBrowser from './components/MiniBrowser';

function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50">
      <div className="text-center mb-12">
        <h1 className="text-6xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-4">
          Ultra Browser
        </h1>
        <p className="text-gray-600 text-xl font-light">
          Premium browser streaming at 30 FPS
        </p>
        <div className="mt-6 flex items-center justify-center space-x-6 text-sm">
          <span className="flex items-center text-gray-500">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
            Live Connection
          </span>
          <span className="flex items-center text-gray-500">
            <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            High Performance
          </span>
          <span className="flex items-center text-gray-500">
            <svg className="w-4 h-4 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Secure Stream
          </span>
        </div>
      </div>
      <MiniBrowser />
    </div>
  );
}

export default App;