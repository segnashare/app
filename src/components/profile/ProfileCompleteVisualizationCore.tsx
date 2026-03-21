"use client";

import { ProfileView } from "./ProfileView";
import { useProfileViewData } from "./useProfileViewData";

type ProfileCompleteVisualizationCoreProps = {
  displayName?: string | null;
};

export function ProfileCompleteVisualizationCore({ displayName }: ProfileCompleteVisualizationCoreProps) {
  const { data, isLoading } = useProfileViewData(null, displayName);

  return (
    <ProfileView
      mode="visualisation"
      data={data}
      isLoading={isLoading}
    />
  );
}
