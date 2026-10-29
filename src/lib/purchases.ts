import { Capacitor } from "@capacitor/core";
import { Purchases, type PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { PhotoLibrary, isNativeApp } from "./photoLibrary";

// Subscriptions are bought through the App Store or Google Play inside the iOS/Android app.
// RevenueCat (revenuecat.com) talks to both stores; the server asks it whether someone is
// subscribed. Its public SDK keys come from .env.app (VITE_REVENUECAT_IOS_KEY,
// VITE_REVENUECAT_ANDROID_KEY).

const STORE_KEYS: Record<string, string | undefined> = {
  ios: import.meta.env.VITE_REVENUECAT_IOS_KEY,
  android: import.meta.env.VITE_REVENUECAT_ANDROID_KEY,
};
const storeKey = isNativeApp ? STORE_KEYS[Capacitor.getPlatform()] : undefined;

/** Whether this build can sell the subscription (the phone app, with RevenueCat set up). */
export const canBuy = Boolean(storeKey);

let started: Promise<string> | null = null;

/**
 * Sets up purchases and returns the id the server knows this person by. It is the phone's own
 * id, which survives reinstalling the app, so the free photos and the subscription stay with
 * the phone. Empty on the website.
 */
export function startPurchases(): Promise<string> {
  started ??= (async () => {
    if (!isNativeApp) return "";
    const { id } = await PhotoLibrary.deviceId().catch(() => ({ id: "" }));
    if (!storeKey) return id;
    try {
      await Purchases.configure({ apiKey: storeKey, appUserID: id || undefined });
      return (await Purchases.getAppUserID()).appUserID;
    } catch (err) {
      console.warn("Purchases are unavailable:", err);
      return id;
    }
  })();
  return started;
}

export type Offer = {
  pkg: PurchasesPackage;
  /** The regular monthly price, e.g. "$4.99". */
  price: string;
  /** The first month's price, when this person qualifies for it, e.g. "$1.99". */
  introPrice: string | null;
};

/** The monthly subscription as the store sells it here (local currency, discount if eligible). */
export async function monthlyOffer(): Promise<Offer | null> {
  if (!canBuy) return null;
  await startPurchases();
  const { current } = await Purchases.getOfferings();
  const pkg = current?.monthly ?? current?.availablePackages[0];
  if (!pkg) return null;
  const intro = pkg.product.introPrice;
  return { pkg, price: pkg.product.priceString, introPrice: intro && intro.price > 0 ? intro.priceString : null };
}

/** Opens the store's purchase sheet. False if the person backed out. */
export async function buy(offer: Offer): Promise<boolean> {
  try {
    await Purchases.purchasePackage({ aPackage: offer.pkg });
    return true;
  } catch (err) {
    const e = err as { userCancelled?: boolean | null; code?: string | number };
    if (e.userCancelled || String(e.code) === "1") return false;
    throw err;
  }
}

/** Brings back a subscription bought on another phone or before reinstalling. */
export async function restore(): Promise<void> {
  await startPurchases();
  await Purchases.restorePurchases();
}
