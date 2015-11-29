import { LinkedList, ListNode, InternedString, Dict, dict, intern, symbol } from 'glimmer-util';
import { Reference, RootReference } from '../types';
import { ConstReference } from './const';
import UpdatableReference from './root';

export const REFERENCE_ITERATOR: string = symbol("reference-iterator");

export interface ListDelegate {
  retain(key: InternedString, item: RootReference);
  insert(key: InternedString, item: RootReference, before: InternedString);
  move(key: InternedString, item: RootReference, before: InternedString);
  delete(key: InternedString);
  done();
}

class ListItem extends ListNode<UpdatableReference> {
  public key: InternedString;
  public handled: boolean = true;

  constructor(value: UpdatableReference, key: InternedString) {
    super(value);
    this.key = key;
  }

  handle(value: any) {
    this.handled = true;
    this.value.update(value);
  }
}

export class ListManager {
  private array: RootReference;
  private keyPath: InternedString;

  private map = dict<ListItem>();
  private list = new LinkedList<ListItem>();

  constructor(array: RootReference, keyPath: InternedString) {
    this.array = array;
    this.keyPath = keyPath;
  }

  iterator(target: ListDelegate): ListIterator {
    let { array, map, list, keyPath } = this;

    let keyFor;

    if (keyPath === '@index') {
      keyFor = (_, index: number) => {
        return String(index);
      };
    } else {
      keyFor = (item: InternedString) => {
        return intern(item[<string>keyPath]);
      };
    }


    return new ListIterator({ array: array.value(), keyFor, target, map, list });
  }

  sync(target: ListDelegate) {
    let iterator = this.iterator(target);
    while (!iterator.next());
  }
}

interface IteratorOptions {
  array: any[];
  keyFor: (obj: any, index: number) => InternedString;
  target: ListDelegate;
  map: Dict<ListItem>;
  list: LinkedList<ListItem>;
}

enum Phase {
  Append,
  Prune,
  Done
}

export class ListIterator {
  private candidates = dict<ListItem>();
  private array: any[];
  private keyFor: (obj, index: number) => InternedString;
  private target: ListDelegate;

  private map: Dict<ListItem>;
  private list: LinkedList<ListItem>;

  private arrayPosition = 0;
  private listPosition: ListItem;
  private phase: Phase = Phase.Append;

  constructor({ array, keyFor, target, map, list }: IteratorOptions) {
    this.array = array;
    this.keyFor = keyFor;
    this.target = target;
    this.map = map;
    this.list = list;

    this.listPosition = list.head();
  }

  advanceToKey(key: InternedString) {
    let { listPosition, candidates, list } = this;

    let seek = listPosition;

    while (seek && seek.key !== key) {
      candidates[<string>seek.key] = seek;
      seek = list.nextNode(seek);
    }

    this.listPosition = seek && list.nextNode(seek);
  }

  next(): boolean {
    while (true) {
      let handled = false;
      switch (this.phase) {
        case Phase.Append: handled = this.nextAppend(); break;
        case Phase.Prune: handled = this.nextPrune(); break;
        case Phase.Done: this.nextDone(); return true;
      }

      if (handled) return false;
    }
  }

  private nextAppend(): boolean {
    let { keyFor, array, listPosition, list, map, candidates, target } = this;

    if (array.length <= this.arrayPosition) {
      this.phase = Phase.Prune;
      this.listPosition = list.head();
      return;
    }

    let item = array[this.arrayPosition++];

    if (item === null || item === undefined) return this.nextAppend();

    let key = keyFor(item, this.arrayPosition - 1);

    if (listPosition && listPosition.key === key) {
      listPosition.handle(item);
      this.listPosition = list.nextNode(listPosition);
      target.retain(key, item);
      return
    } else if (map[<string>key]) {
      let found = map[<string>key];
      found.handle(item);

      if (candidates[<string>key]) {
        list.remove(found);
        list.insertBefore(found, listPosition);
        target.move(found.key, found.value, listPosition ? listPosition.key : null);
      } else {
        this.advanceToKey(key);
      }

      return;
    } else {
      let reference = new UpdatableReference(item);
      let node = map[<string>key] = new ListItem(reference, key);
      list.append(node);
      target.insert(node.key, node.value, listPosition ? listPosition.key : null);
      return true;
    }
  }

  private nextPrune(): boolean {
    let { list, target } = this;

    if (this.listPosition === null) {
      this.phase = Phase.Done;
      return;
    }

    let node = this.listPosition;
    this.listPosition = list.nextNode(node);

    if (node.handled) {
      node.handled = false;
      return;
    } else {
      list.remove(node);
      delete this.map[<string>node.key];
      target.delete(node.key);
      return;
    }
  }

  private nextDone() {
    this.target.done();
  }
}
