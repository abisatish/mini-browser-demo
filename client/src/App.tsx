import MiniBrowser from './components/MiniBrowser';

function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold text-gray-800 mb-3 drop-shadow-lg">
          Mini Browser Demo
        </h1>
        <p className="text-gray-600 text-xl">
          High-quality streaming with smooth scrolling and 30 FPS
        </p>
        <div className="mt-4 flex items-center justify-center space-x-4 text-sm text-gray-500">
          <span className="flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
            Click to interact
          </span>
          <span className="flex items-center">
            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2"></div>
            Scroll wheel support
          </span>
          <span className="flex items-center">
            <div className="w-2 h-2 bg-purple-500 rounded-full mr-2"></div>
            30 FPS streaming
          </span>
        </div>
      </div>
      <MiniBrowser />
    </div>
  );
}

export default App;
