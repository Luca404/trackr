-- FitTrackr: explicitly bind both parent keys. Existing rows are retained.
ALTER POLICY "own meal_items" ON public.meal_items TO authenticated
 USING (EXISTS(SELECT 1 FROM public.meal_entries e JOIN public.meals m ON m.id=e.meal_id
 WHERE e.id=meal_items.entry_id AND e.meal_id=meal_items.meal_id AND m.user_id=auth.uid()))
 WITH CHECK (EXISTS(SELECT 1 FROM public.meal_entries e JOIN public.meals m ON m.id=e.meal_id
 WHERE e.id=meal_items.entry_id AND e.meal_id=meal_items.meal_id AND m.user_id=auth.uid()));
CREATE UNIQUE INDEX meal_entries_id_meal_id ON public.meal_entries(id,meal_id);
ALTER TABLE public.meal_items ADD CONSTRAINT meal_items_entry_meal_fk
 FOREIGN KEY(entry_id,meal_id) REFERENCES public.meal_entries(id,meal_id) ON DELETE CASCADE NOT VALID;
-- NOT VALID enforces all new writes without discarding or rewriting historical anomalies.
