export type ItemFeedbackDisplayRow = {
  id: string;
  rating: number;
  comment: string | null;
  reviewerDisplayName: string;
  createdAt: string;
};

export type ItemWornPhotoDisplayRow = {
  feedbackId: string;
  storagePath: string;
  previewUrl: string | null;
  createdAt: string;
};

export type CartReturnFeedbackExistingWornPhoto = {
  id: string;
  storagePath: string;
  previewUrl: string | null;
};

export type CartReturnFeedbackLineState = {
  cartItemId: string;
  itemId: string;
  itemName: string;
  brand: string | null;
  photoUrl: string | null;
  existingRating: number | null;
  existingComment: string | null;
  existingWornPhotos: CartReturnFeedbackExistingWornPhoto[];
};

export type CartReturnFeedbackDraft = {
  cartItemId: string;
  itemId: string;
  rating: number;
  comment: string;
  keepWornPhotoPaths?: string[];
  wornPhotoFiles?: File[];
};
