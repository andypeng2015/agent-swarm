import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { FavoriteItemType } from "../types";

const ENTITY_QUERY_KEYS: Record<FavoriteItemType, string[]> = {
  page: ["pages", "page"],
  workflow: ["workflows", "workflow"],
  schedule: ["scheduled-tasks", "scheduled-task"],
};

export function useFavorites(itemType: FavoriteItemType, itemIds?: string[]) {
  return useQuery({
    queryKey: ["favorites", itemType, itemIds],
    queryFn: () => api.listFavorites({ itemType, itemIds }),
    staleTime: 30_000,
  });
}

export function useFavoriteToggle(itemType: FavoriteItemType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, favorite }: { itemId: string; favorite: boolean }) =>
      api.setFavorite({ itemType, itemId, favorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", itemType] });
      for (const key of ENTITY_QUERY_KEYS[itemType]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
