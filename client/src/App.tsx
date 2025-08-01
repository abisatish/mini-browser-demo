import MiniBrowser from './components/MiniBrowser';

function App() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50">
      <div className="flex items-center justify-center w-full h-full">
        <MiniBrowser />
      </div>
    </div>
  );
}

export default App;