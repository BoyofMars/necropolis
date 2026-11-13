/** Every scene gets its local time t (seconds since it starts; negative or past d during transitions), its length d, and the global time T. */
export type SceneProps = { t: number; d: number; T: number; frame: number };

/** Live values read from NEAR before rendering (scripts/data.ts → public/data.json). */
export type Data = {
  grave: {
    id: number;
    symbol: string;
    amount: string;
    chain: string;
    graveAddress: string;
    bones: number;
    account: string;
    depositTx: string;
    proofHash: string;
    epitaph: string;
    owner: string;
    secondsToMint: number;
  };
  stats: { graves: number; bonesSupply: number; buried: number };
};

declare global {
  interface Window {
    __DATA: Data;
  }
}
export const data = () => window.__DATA;
