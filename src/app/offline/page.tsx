
// Using simple HTML with inline styles for robustness when offline.
// No dependency on CSS files or other components.
export default function OfflinePage() {
  return (
    <div style={{ fontFamily: 'sans-serif', textAlign: 'center', padding: '4rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Você está offline</h1>
      <p style={{ fontSize: '1.125rem', color: '#71717a' }}>
        Por favor, verifique sua conexão com a internet para acessar todo o conteúdo.
      </p>
    </div>
  );
}
