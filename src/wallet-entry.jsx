import "./browser-polyfills.js";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  PrivyProvider,
  usePrivy,
  useSessionSigners,
  useSign7702Authorization,
  useWallets,
  useAuthorizationSignature,
  useFiatOnramp,
} from "@privy-io/react-auth";
import { base } from "viem/chains";
import { createPosterApi } from "./azzle-chain.js";

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function linkedPrivyWallet(wallet, user) {
  const address = String(wallet?.address || "").toLowerCase();
  return (
    user?.linkedAccounts?.find(
      (account) =>
        account?.type === "wallet" &&
        account?.walletClientType === "privy" &&
        String(account.address || "").toLowerCase() === address
    ) ?? null
  );
}

function isWalletDelegated(wallet, user) {
  return Boolean(linkedPrivyWallet(wallet, user)?.delegated);
}

function emitWallet(address, extra = {}) {
  window.dispatchEvent(
    new CustomEvent("azzle-wallet-change", {
      detail: { address: address ?? null, chainId: base.id, ...extra },
    })
  );
}

function pickWallet(wallets) {
  return (
    // EIP-7702 authorization is signed by Privy's embedded-wallet hook.
    // Keep the wallet client and authorization signer on the same address.
    wallets.find((w) => w.walletClientType === "privy" && w.chainId === `eip155:${base.id}`) ??
    wallets.find((w) => w.walletClientType === "privy") ??
    wallets.find((w) => w.chainId === `eip155:${base.id}`) ??
    wallets[0] ??
    null
  );
}

function PosterBridge({ signerId, usdcAddress }) {
  const { ready, authenticated, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { addSessionSigners } = useSessionSigners();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { signAuthorization } = useSign7702Authorization();
  const { fund } = useFiatOnramp();
  const wallet = pickWallet(wallets);

  useEffect(() => {
    window.azzleLogout = authenticated ? () => logout() : null;
    window.azzleGetAccessToken = authenticated ? () => getAccessToken() : null;
    window.azzleSignWalletApi =
      authenticated && wallet?.walletClientType === "privy"
        ? (input) => generateAuthorizationSignature(input)
        : null;
    window.azzleEnableSwaps =
      authenticated && wallet?.walletClientType === "privy"
        ? async () => {
            if (!isWalletDelegated(wallet, user)) {
              const quorumId = String(signerId || "").trim();
              if (!quorumId) {
                throw new Error(
                  "Add PRIVY_SIGNER_ID from Privy Dashboard → Wallet infrastructure → Authorization keys, then restart the site."
                );
              }
              await addSessionSigners({
                address: wallet.address,
                signers: [{ signerId: quorumId, policyIds: [] }],
              });
            }
            window.azzleWalletMeta = {
              ...(window.azzleWalletMeta || {}),
              address: wallet.address,
              walletClientType: "privy",
              walletDelegated: true,
            };
            emitWallet(wallet.address, {
              walletClientType: "privy",
              walletDelegated: true,
            });
            return true;
          }
        : null;
    window.azzleFundUsdc =
      authenticated && wallet
        ? async ({ amount } = {}) => {
            const dest = String(usdcAddress || "").trim();
            if (!/^0x[a-fA-F0-9]{40}$/i.test(dest)) {
              throw new Error("USDC is not configured.");
            }
            return fund({
              source: {
                assets: ["usd", "eur", "gbp"],
                defaultAsset: "usd",
              },
              destination: {
                asset: dest,
                chain: `eip155:${base.id}`,
                address: wallet.address,
              },
              environment: "production",
              defaultAmount: String(amount || "50"),
            });
          }
        : null;
    return () => {
      window.azzleLogout = null;
      window.azzleGetAccessToken = null;
      window.azzleSignWalletApi = null;
      window.azzleEnableSwaps = null;
      window.azzleFundUsdc = null;
    };
  }, [
    authenticated,
    logout,
    getAccessToken,
    addSessionSigners,
    generateAuthorizationSignature,
    fund,
    wallet,
    user,
    signerId,
    usdcAddress,
  ]);

  useEffect(() => {
    window.azzlePoster = createPosterApi({
      ready,
      authenticated,
      wallet: authenticated ? wallet : null,
      signAuthorization: authenticated ? signAuthorization : null,
    });
    window.azzleWalletMeta = {
      address: authenticated ? wallet?.address ?? null : null,
      walletClientType: authenticated ? wallet?.walletClientType ?? null : null,
      walletDelegated: authenticated ? isWalletDelegated(wallet, user) : false,
    };
    window.dispatchEvent(new Event("azzle-poster-ready"));
  }, [ready, authenticated, wallet, user, signAuthorization]);

  return null;
}

function WalletControlsUnconfigured() {
  return (
    <button
      type="button"
      className="rd-wallet-btn rd-wallet-btn--off"
      disabled
      title="Add PRIVY_APP_ID to Vercel env vars and redeploy"
    >
      Sign in
    </button>
  );
}

function WalletControlsInner() {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();

  const address =
    pickWallet(wallets)?.address ?? user?.wallet?.address ?? null;

  useEffect(() => {
    if (!ready) return;
    const wallet = pickWallet(wallets);
    emitWallet(authenticated ? address : null, {
      walletClientType: authenticated ? wallet?.walletClientType ?? null : null,
      walletDelegated: authenticated ? isWalletDelegated(wallet, user) : false,
    });
  }, [ready, authenticated, address, wallets, user]);

  if (authenticated && address) {
    return (
      <a
        href="/wallet"
        className="rd-wallet-btn rd-wallet-btn--on"
        title={"Wallet on Base · " + address + " · click to open"}
      >
        {shortAddr(address)}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="rd-wallet-btn"
      onClick={() => login()}
      title={ready ? "Sign in with email or wallet" : "Loading sign-in…"}
    >
      {ready ? "Sign in" : "…"}
    </button>
  );
}

const PRIVY_CONFIG = {
  loginMethods: ["email", "wallet"],
  appearance: {
    theme: "light",
    accentColor: "#00c896",
    showWalletLoginFirst: false,
  },
  defaultChain: base,
  supportedChains: [base],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
    showWalletUIs: false,
  },
};

function WalletTree({ appId, clientId, signerId, usdcAddress, mountNodes }) {
  if (!appId) {
    return mountNodes.map((node, i) =>
      createPortal(<WalletControlsUnconfigured key={"off-" + i} />, node)
    );
  }

  return (
    <PrivyProvider appId={appId} clientId={clientId || undefined} config={PRIVY_CONFIG}>
      <PosterBridge signerId={signerId} usdcAddress={usdcAddress} />
      {mountNodes.map((node, i) =>
        createPortal(<WalletControlsInner key={"in-" + i} />, node)
      )}
    </PrivyProvider>
  );
}

async function loadPrivyConfig() {
  try {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.privyAppId) {
        return {
          appId: cfg.privyAppId,
          clientId: cfg.privyClientId ?? "",
          signerId: cfg.privySignerId ?? "",
          usdcAddress: cfg.contracts?.usdc ?? "",
        };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch("/privy-config.json", { cache: "no-store" });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.privyAppId) {
        return {
          appId: cfg.privyAppId,
          clientId: cfg.privyClientId ?? "",
          signerId: cfg.privySignerId ?? "",
          usdcAddress: cfg.contracts?.usdc ?? cfg.usdc ?? "",
        };
      }
    }
  } catch {
    /* offline / missing */
  }

  return { appId: "", clientId: "", signerId: "", usdcAddress: "" };
}

async function boot() {
  const mountNodes = [...document.querySelectorAll("[data-rd-wallet-mount]")];
  if (!mountNodes.length) return;

  const { appId, clientId, signerId, usdcAddress } = await loadPrivyConfig();

  const host = document.createElement("div");
  host.id = "rd-wallet-host";
  host.hidden = true;
  document.body.appendChild(host);

  createRoot(host).render(
    <WalletTree appId={appId} clientId={clientId} signerId={signerId} usdcAddress={usdcAddress} mountNodes={mountNodes} />
  );
}

boot();
