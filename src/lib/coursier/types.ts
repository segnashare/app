export type CoursierAddress = {
  Address: string;
  PostalCode: string;
  City: string;
  Country: string;
};

/** Adresse complète pour `order.php` (contacts requis). */
export type CoursierOrderAddress = CoursierAddress & {
  Company?: string;
  Contact: string;
  Email?: string;
  PhoneNumber: string;
  Comment?: string;
};

export type CoursierPackage = {
  Name: string;
  NumberOfPackage: number;
  Weight: number;
  Length: number;
  Width: number;
  Height: number;
};

/** Ligne brute renvoyée par `POST …/v3/getprice.php`. */
export type CoursierGetPriceOffer = {
  ServiceId: string;
  Service: string;
  PickupStartDate: string;
  PickupEndDate: string;
  DeliveryStartDate: string;
  DeliveryEndDate: string;
  Price: string;
};

/** Devis express normalisé pour le checkout (remplace le devis Uber Direct). */
export type CoursierNormalizedExpressQuote = {
  provider: "coursier";
  serviceId: string;
  service: string;
  /** Prix HT en centimes (aligné facturation Segna). */
  priceHtCents: number;
  pickupStartDate: string;
  pickupEndDate: string;
  deliveryStartDate: string;
  deliveryEndDate: string;
  offers: CoursierGetPriceOffer[];
};

/** Réponse `POST …/v3/order.php`. */
export type CoursierOrderResponse = {
  MissionNumber: string;
  PickupStartDate: string;
  PickupEndDate: string;
  DeliveryStartDate: string;
  DeliveryEndDate: string;
  price: string | number;
  CO2?: string | number;
};

/** Ligne `POST …/v3/tracking.php`. */
export type CoursierTrackingRow = {
  MissionId: string;
  MissionNumber: string;
  From: string;
  To: string;
  PickupStartDate: string;
  PickupEndDate: string;
  PickupStartEstimate: string;
  PickupEndEstimate: string;
  PickupDate: string;
  DeliveryStartDate: string;
  DeliveryEndDate: string;
  DeliveryStartEstimate: string;
  DeliveryEndEstimate: string;
  DeliveryDate: string;
  State: string;
  WorkerShortCode: string;
  WorkerSurname: string;
  Picture: string;
  ProofOfDelivery: string;
  DeliverySignee: string;
};

/** Résultat post-confirmation panier (ne bloque jamais la commande). */
export type CoursierStripePostResult =
  | { status: "not_applicable" }
  | { status: "skipped"; reason: "config" | "address_metadata" | "phone" }
  | { status: "created"; missionNumber: string }
  | { status: "duplicate_ignored" }
  | { status: "failed"; error: string };
