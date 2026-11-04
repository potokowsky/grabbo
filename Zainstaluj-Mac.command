#!/bin/bash
# Dwuklik w Finderze uruchamia instalację
cd "$(dirname "$0")"
bash ./install.sh
echo ""
read -r -p "Naciśnij Enter, żeby zamknąć to okno…" _
