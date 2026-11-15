import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-4 text-center">
      <h2 className="text-2xl font-bold mb-2">Página não encontrada</h2>
      <p className="text-muted-foreground mb-4">Não conseguimos encontrar o que você está procurando.</p>
      <Link 
        href="/"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Voltar ao Feed
      </Link>
    </div>
  );
}
