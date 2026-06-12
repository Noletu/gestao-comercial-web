export interface HealthStatus {
  status: "ok";
  timestamp: string;
}

/**
 * Retorna o estado de saúde da API. Mantido na camada de serviço (e não inline
 * na rota) para crescer depois com checagens reais — ex.: ping no Postgres na
 * issue #2 — sem mexer na rota.
 */
export function getHealth(): HealthStatus {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}
