import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Gestão Comercial
      </h1>
      <p className="text-lg text-gray-500">em construção</p>
      <Link
        href="/login"
        className="rounded bg-gray-900 px-4 py-2 font-medium text-white"
      >
        Entrar
      </Link>
    </main>
  );
}
