#pragma once
#include "CoreMinimal.h"

// ---------------------------------------------------------------------------
// Blue Hour route — C++ port of src/world/route.js.
// Constants mirror src/core/config.js ROUTE so the web and UE worlds are the
// same map. Internal math in meters (JS coords: X east, Z forward, Y up);
// world-facing functions take/return UE centimeters (X fwd, Y right, Z up)
// with the mapping ue_x = js_z*100, ue_y = js_x*100, ue_z = js_y*100.
// A heading of h (rad) maps 1:1 to UE yaw in degrees.
// ---------------------------------------------------------------------------
namespace BHRoute
{
    // [amplitude, frequency, phase] — must match config.js ROUTE.heading
    constexpr float HeadingTerms[5][3] = {
        {0.62f, 0.0021f, 0.0f},   {1.05f, 0.00085f, 1.35f},
        {0.34f, 0.0061f, 0.65f},  {0.30f, 0.0145f, 4.2f},
        {0.22f, 0.028f, 2.0f}};
    constexpr float HeadingBias = -1.169f;
    // must match config.js ROUTE.elevation
    constexpr float ElevTerms[3][3] = {
        {17.0f, 0.0013f, 0.4f}, {8.0f, 0.0036f, 1.7f}, {2.2f, 0.009f, 0.0f}};
    constexpr float BankScale = 11.f;
    constexpr float BankClamp = 0.085f;
    constexpr float RoadHalfM = 7.f;
    constexpr float StepM = 4.f;      // export-resample density (export_route.py)
    constexpr float LengthM = 6000.f; // baked route length — keep == --length
    constexpr float TerrainHalfM = 400.f;
    constexpr float CellM = 64.f;     // spatial-hash cell size

    inline float HeadingAt(float s)
    {
        float h = HeadingBias;
        for (auto& t : HeadingTerms) h += t[0] * FMath::Sin(s * t[1] + t[2]);
        return h;
    }
    inline float CurvatureAt(float s)
    {
        float k = 0.f;
        for (auto& t : HeadingTerms) k += t[0] * t[1] * FMath::Cos(s * t[1] + t[2]);
        return k;
    }
    inline float ElevationAt(float s)
    {
        float y = 0.f;
        for (auto& t : ElevTerms) y += t[0] * FMath::Sin(s * t[1] + t[2]);
        return y;
    }
    inline float BankAt(float s)
    {
        return -FMath::Clamp(CurvatureAt(s) * BankScale, -BankClamp, BankClamp);
    }
    inline float TurnLimit(float s)
    {
        const float k = FMath::Abs(CurvatureAt(s));
        return k > 1e-5f ? FMath::Min(90.f, 0.82f / k) : 90.f;
    }
    // route.js groundOffset() — bank already resolved
    inline float GroundOffset(float s, float lat, float bank)
    {
        const float outer = FMath::Max(0.f, FMath::Abs(lat) - 8.f);
        const float hill = FMath::Sin(s * 0.009f + lat * 0.043f) * 0.19f
                         + FMath::Sin(s * 0.0028f - lat * 0.077f) * 0.28f;
        const float swell = FMath::Sin(s * 0.0019f + FMath::Abs(lat) * 0.021f + 2.1f)
                          * FMath::Sin(s * 0.00073f - lat * 0.011f + 0.6f)
                          * FMath::Min(outer, 64.f) * 0.11f;
        const float lumps = FMath::Sin(s * 0.11f + lat * 0.31f)
                          * FMath::Min(outer, 12.f) * 0.028f;
        return lat * bank - 0.11f
             + outer * 0.047f + outer * hill * 0.13f
             + FMath::Sin(s * 0.045f + lat * 0.20f) * FMath::Min(outer, 20.f) * 0.035f
             + swell + lumps;
    }

    // Lazy-initialized path polyline (JS meters) + 64 m spatial hash.
    struct FPath
    {
        TArray<FVector2D> Pts;                 // js (x,z), StepM spacing
        TMap<int64, TArray<int32>> Grid;
        bool bInit = false;
        void Ensure()
        {
            if (bInit) return;
            Pts.Reserve(int32(LengthM / StepM) + 2);
            float x = 0, z = 0;
            Pts.Add(FVector2D(0, 0));
            const int32 n = int32(LengthM / StepM);
            for (int32 i = 0; i < n; ++i)
            {
                const float h = HeadingAt((i + 0.5f) * StepM);
                x += FMath::Sin(h) * StepM;
                z += FMath::Cos(h) * StepM;
                const int32 idx = Pts.Add(FVector2D(x, z));
                const int64 key = int64(FMath::FloorToInt(x / CellM)) * 100000
                                + FMath::FloorToInt(z / CellM);
                Grid.FindOrAdd(key).Add(idx);
            }
            // index cell of point 0 too
            Grid.FindOrAdd(0).Add(0);
            bInit = true;
        }
        bool Nearest(FVector2D p, float& outS, float& outLat) const
        {
            const int32 cx = FMath::FloorToInt(p.X / CellM);
            const int32 cy = FMath::FloorToInt(p.Y / CellM);
            float bestD2 = MAX_flt; int32 best = -1;
            for (int32 ring = 0; ring < 10; ++ring)
            {
                bool any = false;
                for (int32 dx = -ring; dx <= ring; ++dx)
                    for (int32 dy = -ring; dy <= ring; ++dy)
                    {
                        if (FMath::Max(FMath::Abs(dx), FMath::Abs(dy)) != ring) continue;
                        const int64 key = int64(cx + dx) * 100000 + (cy + dy);
                        if (const TArray<int32>* cell = Grid.Find(key))
                            for (int32 i : *cell)
                            {
                                any = true;
                                const float d2 = FVector2D::DistSquared(Pts[i], p);
                                if (d2 < bestD2) { bestD2 = d2; best = i; }
                            }
                    }
                if (best >= 0 && bestD2 <= FMath::Square(ring * CellM)) break;
                (void)any;
            }
            if (best < 0) return false;
            // project onto neighbor segments for continuous s + signed lateral
            float bD2 = MAX_flt, bLat = 0, bS = best * StepM;
            for (int32 j = FMath::Max(0, best - 1);
                 j < FMath::Min(Pts.Num() - 1, best + 1); ++j)
            {
                const FVector2D a = Pts[j], d = Pts[j + 1] - a;
                const float L2 = d.SizeSquared();
                if (L2 <= 0.f) continue;
                const float t = FMath::Clamp(
                    FVector2D::DotProduct(p - a, d) / L2, 0.f, 1.f);
                const FVector2D q = a + d * t;
                const float d2 = FVector2D::DistSquared(q, p);
                if (d2 < bD2)
                {
                    bD2 = d2;
                    bLat = ((p.X - q.X) * d.Y - (p.Y - q.Y) * d.X) / FMath::Sqrt(L2);
                    bS = (j + t) * StepM;
                }
            }
            outS = bS; outLat = bLat; return true;
        }
    };
    inline FPath& Path()
    {
        static FPath P; P.Ensure(); return P;
    }

    // ---- UE-facing helpers (centimeters) -----------------------------------

    // Centerline at arclength s (meters) -> UE cm position.
    inline FVector PosCm(float sM)
    {
        FPath& P = Path();
        const float f = FMath::Clamp(sM / StepM, 0.f, float(P.Pts.Num() - 1));
        const int32 i = int32(f);
        const FVector2D a = P.Pts[i], b = P.Pts[FMath::Min(i + 1, P.Pts.Num() - 1)];
        const FVector2D js = FMath::Lerp(a, b, f - i);
        return FVector(js.Y * 100.f, js.X * 100.f, ElevationAt(sM) * 100.f);
    }
    inline float HeadingDeg(float sM) { return FMath::RadiansToDegrees(HeadingAt(sM)); }
    // UE right vector of the corridor at s.
    inline FVector2D RightUE(float sM)
    {
        const float h = HeadingAt(sM);
        return FVector2D(-FMath::Sin(h), FMath::Cos(h)); // (ue_x=-sin? see note)
    }
    // NOTE: js right = (cos h, -sin h) over (x,z) -> ue (x=z,y=x) maps to
    //       rightUE = (-sin h, cos h). Verified: h=0 -> (0,1)=+Y right.

    // World (X,Y) cm -> s + signed lateral (m), false if outside corridor band.
    inline bool Locate(float xCm, float yCm, float& sM, float& latM)
    {
        // ue(x,y) -> js(x,y): js.x = ue.y/100, js.z = ue.x/100
        return Path().Nearest(FVector2D(yCm * 0.01f, xCm * 0.01f), sM, latM);
    }
    inline float AbsLateralCm(float xCm, float yCm)
    {
        float s, lat;
        return Locate(xCm, yCm, s, lat) ? FMath::Abs(lat) * 100.f : MAX_flt;
    }
    // Terrain height (cm) at world XY via the corridor heightfield.
    inline float WorldZcm(float xCm, float yCm)
    {
        float s, lat;
        if (!Locate(xCm, yCm, s, lat) || FMath::Abs(lat) > TerrainHalfM)
            return -3000.f; // far skirt: below road so the car can't fall forever
        const float b = BankAt(s);
        return (ElevationAt(s) + GroundOffset(s, lat, b)) * 100.f;
    }
    // Drive surface: road deck inside corridor width, terrain outside.
    inline float SurfaceZcm(float xCm, float yCm)
    {
        float s, lat;
        if (!Locate(xCm, yCm, s, lat)) return WorldZcm(xCm, yCm);
        const float aLat = FMath::Abs(lat);
        if (aLat <= RoadHalfM + 0.4f)
            return (ElevationAt(s) + lat * BankAt(s)) * 100.f;
        return WorldZcm(xCm, yCm);
    }
    inline float LengthCm() { return LengthM * 100.f; }
    inline FBox2D BoundsM()
    {
        FPath& P = Path();
        FBox2D b(EForceInit::ForceInit);
        for (auto& p : P.Pts) b += p;
        return b;
    }
}
