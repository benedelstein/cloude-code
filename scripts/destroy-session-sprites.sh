#!/bin/bash

# Destroy all session- sprites

sprite list | grep '^session-' | while read -r sprite_name; do
  echo "Destroying $sprite_name..."
  sprite destroy -s "$sprite_name" --force
done

echo "Done."
