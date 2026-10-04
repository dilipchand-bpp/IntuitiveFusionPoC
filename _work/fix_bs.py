import sys

for p in sys.argv[1:]:
    b = open(p, 'rb').read()
    n = b.count(bytes([8]))
    open(p, 'wb').write(b.replace(bytes([8]), bytes([92, 98])))
    print(p, n)
