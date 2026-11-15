import Link from 'next/link';

export default function GlobalNotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center text-center p-4">
        <h1 className="text-2xl font-bold mb-4">404 - Página não encontrada</h1>
        <p className="mb-4">O recurso que você procura não existe.</p>
        <Link href="/" className="text-blue-500 underline">
          Voltar para o início
        </Link>
    </div>
  );
}
