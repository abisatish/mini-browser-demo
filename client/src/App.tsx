import MiniBrowser from './components/MiniBrowser';

function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-2 drop-shadow-lg">Mini Browser Demo</h1>
        <p className="text-white/80 text-lg">High-quality streaming with smooth scrolling</p>
      </div>
      <MiniBrowser />
    </div>
  );
}

export default App;
