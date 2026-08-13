# YouTube Precision Volume

Extension Chrome (Manifest V3) pour régler très précisément le volume des
vidéos YouTube, notamment **sous 1 %** — utile la nuit, au casque, ou pour
les vidéos trop fortes que le curseur natif de YouTube ne permet pas de
baisser assez finement.

## Fonctionnalités

- Popup accessible depuis l'icône de l'extension.
- Boutons rapides : 0,01 % · 0,1 % · 0,5 % · 1 % · 2 % · 5 % · 10 %.
- Champ de saisie d'une valeur personnalisée en pourcentage (de 0 à 100,
  virgule ou point acceptés, ex. `0,25`).
- Affichage du volume actuel de la vidéo.
- Le volume est appliqué directement sur l'élément vidéo de la page :
  `document.querySelector('video').volume`. Par exemple, 0,1 % donne
  `video.volume = 0.001`.

100 % HTML/CSS/JavaScript vanilla : aucun framework, aucune dépendance,
aucune collecte de données, aucune requête réseau.

## Permissions

L'extension demande le strict minimum :

- `activeTab` — accès à l'onglet actif uniquement quand vous cliquez sur
  l'icône de l'extension ;
- `scripting` — nécessaire pour lire et modifier `video.volume` dans la page.

Aucun accès permanent aux sites, aucun accès en arrière-plan.

## Installation (mode développeur)

1. Ouvrir Chrome et aller à `chrome://extensions`.
2. Activer le **Mode développeur** (interrupteur en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le
   dossier de ce projet (`youtube-precision-volume`).
4. (Optionnel) Épingler l'icône via le menu extensions (pièce de puzzle).

## Utilisation

1. Ouvrir une vidéo YouTube.
2. Cliquer sur l'icône de l'extension.
3. Cliquer sur un bouton rapide, ou saisir un pourcentage puis **Appliquer**.

Remarque : YouTube conserve son propre curseur de volume ; si vous le
manipulez après coup, il reprend la main sur le volume de la vidéo.

## Licence

[MIT](LICENSE)
