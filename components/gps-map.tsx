"use client";

import { Map, Marker } from "pigeon-maps";

type Props = {
  latitude: number | null;
  longitude: number | null;
  onSelect: (latitude: number, longitude: number) => void;
};

const abidjan: [number, number] = [5.36, -4.008];

export function GpsMap({ latitude, longitude, onSelect }: Props) {
  const position: [number, number] | null = latitude !== null && longitude !== null
    ? [latitude, longitude] : null;

  return <div className="gps-map-wrap">
    <div className="gps-map" aria-label="Carte pour choisir la position GPS">
      <Map defaultCenter={position ?? abidjan} defaultZoom={position ? 16 : 12}
        onClick={({ latLng }) => onSelect(latLng[0], latLng[1])}>
        {position && <Marker anchor={position} />}
      </Map>
    </div>
    <div className="gps-map-footer"><span>Touchez la carte pour placer le repère.</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></div>
  </div>;
}
