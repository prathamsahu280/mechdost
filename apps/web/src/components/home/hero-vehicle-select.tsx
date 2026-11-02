'use client';

import { Bike, Car, CarFront } from 'lucide-react';
import { useState } from 'react';
import { Select } from '../ui/select';

type Vehicle = 'any' | '2W' | '4W';

/**
 * The hero's "Vehicle" field as the site's custom select (user 2026-11-02: no native selects in filters). A tiny
 * client island: the hero stays a Server Component, and the hidden input keeps the GET form to /workshops working.
 */
export function HeroVehicleSelect({ labels }: { labels: { any: string; twoW: string; fourW: string } }) {
  const [vehicle, setVehicle] = useState<Vehicle>('any');
  return (
    <Select
      id="hero-vehicle"
      name="vehicle"
      className="mt-1"
      value={vehicle}
      trackPrefix="hero_vehicle"
      options={[
        { value: 'any', label: labels.any, icon: CarFront },
        { value: '2W', label: labels.twoW, icon: Bike },
        { value: '4W', label: labels.fourW, icon: Car },
      ]}
      onChange={setVehicle}
    />
  );
}
